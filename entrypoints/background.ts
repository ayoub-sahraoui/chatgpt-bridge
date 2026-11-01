import { browser } from '#imports';
import { createRouter } from '../lib/bridge/router';
import { BridgeSocket } from '../lib/bridge/socket';
import { TabManager } from '../lib/bridge/tabs';
import { EVENT_TAG, MESSAGE_TAG } from '../lib/protocol';
import type { Settings, WsState } from '../lib/protocol';
import { DEFAULT_SETTINGS, getSettings, settingsItem, statusItem, updateStatus } from '../lib/settings';
import { togglePagePanel } from '../lib/page-panel';

export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (tab.id == null) return;
    try {
      const panelUrl = new URL(browser.runtime.getURL('/popup.html'));
      panelUrl.searchParams.set('panel', '1');
      // Chrome's dynamic resource URL still posts messages from the extension's real ID.
      const panelOrigin = panelUrl.protocol === 'chrome-extension:'
        ? `chrome-extension://${browser.runtime.id}`
        : panelUrl.origin;
      const [result] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: togglePagePanel,
        args: [panelUrl.href, panelOrigin],
      });
      if (result?.result) return;
    } catch {
      // Browser pages and the extension store prohibit injected panels.
    }
    try {
      await browser.action.setPopup({ tabId: tab.id, popup: 'popup.html' });
      await browser.action.openPopup({ windowId: tab.windowId });
    } catch {
      await browser.runtime.openOptionsPage();
    } finally {
      await browser.action.setPopup({ tabId: tab.id, popup: '' });
    }
  });

  const tabs = new TabManager();
  let activeTaskId: string | null = null;
  let wsState: WsState = 'disabled';
  let currentSettings: Settings = { ...DEFAULT_SETTINGS };

  const socket = new BridgeSocket({
    enabled: false,
    serverUrl: currentSettings.serverUrl,
    token: currentSettings.token,
    autoReconnect: currentSettings.autoReconnect,
    reconnectDelayMs: currentSettings.reconnectDelayMs,
  });

  // ── badge ────────────────────────────────────────────────────────────────
  const badge = {
    connected: { text: '✓', color: '#16a34a' },
    connecting: { text: '…', color: '#d97706' },
    disconnected: { text: '!', color: '#dc2626' },
    disabled: { text: '', color: '#71717a' },
  } satisfies Record<string, { text: string; color: string }>;

  function setBadge(state: string) {
    const style = badge[state as keyof typeof badge] ?? badge.disabled;
    void browser.action.setBadgeText({ text: style.text });
    void browser.action.setBadgeBackgroundColor({ color: style.color });
  }

  socket.onStateChange = (state, err) => {
    wsState = state;
    setBadge(state);
    void updateStatus({ wsState: state, lastError: err });
  };

  async function syncChatGPTTabStatus() {
    const tab = await tabs.findChatGPTTab();
    await updateStatus({ chatgptTabId: tab?.id ?? null });
    return tab;
  }

  browser.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
      void syncChatGPTTabStatus();
    }
  });

  browser.tabs.onRemoved.addListener(() => {
    void syncChatGPTTabStatus();
  });

  // ── routing ──────────────────────────────────────────────────────────────
  const handle = createRouter({
    socket,
    tabs,
    getWsState: () => ({ state: wsState, enabled: currentSettings.enabled, serverUrl: currentSettings.serverUrl }),
    setActiveTask: async (taskId) => {
      activeTaskId = taskId;
      await updateStatus({ activeTaskId: taskId });
    },
    getActiveTask: () => activeTaskId,
  });

  socket.onRequest = (req) => handle(req.method, req.params);

  function sendRouterRequest(method: string, params: unknown): Promise<unknown> {
    return handle(method, (params ?? {}) as Record<string, unknown>);
  }

  // ── messages from content script & extension pages ───────────────────────
  browser.runtime.onMessage.addListener(((msg: any, _sender: any, sendResponse: (r: unknown) => void) => {
    if (!msg || typeof msg !== 'object') return false;

    // content → background task events, forwarded to the SDK host
    if (msg[EVENT_TAG]) {
      if (typeof msg.event === 'string' && msg.event.startsWith('task.')) {
        if (msg.event === 'task.completed' || msg.event === 'task.failed' || msg.event === 'task.cancelled') {
          activeTaskId = null;
          void updateStatus({ activeTaskId: null });
        }
        socket.sendEvent(msg.event, msg.payload);
      }
      return false;
    }

    // extension pages (popup/options) using rpc()
    if (msg[MESSAGE_TAG]) {
      void sendRouterRequest(msg.method, msg.params).then(
        (result) => sendResponse({ ok: true, result }),
        (err: any) =>
          sendResponse({
            ok: false,
            error: { code: err?.code ?? 'INTERNAL', message: String(err?.message ?? err) },
          }),
      );
      return true; // async response
    }

    return false;
  }) as any);

  // ── native messaging host ────────────────────────────────────────────────
  let nativePort: any = null;
  let nativeConnecting = false;

  function ensureNativeHost() {
    if (nativePort || nativeConnecting) return;
    if (!currentSettings.enabled) return;

    try {
      nativeConnecting = true;
      const port = (browser.runtime as any).connectNative('com.chatgpt.bridge.server');
      nativePort = port;
      nativeConnecting = false;

      port.onMessage.addListener((msg: any) => {
        if (msg?.type === 'ready' || msg?.type === 'pong' || msg?.status === 'running') {
          // Native host server confirmed bound and listening
          socket.configure(currentSettings);
          socket.reconnectNow();
        }
      });

      port.onDisconnect.addListener(() => {
        nativePort = null;
        nativeConnecting = false;
        if (currentSettings.enabled) {
          setTimeout(() => ensureNativeHost(), 1000);
          if (!socket.isConnected) {
            socket.configure(currentSettings);
            socket.ensureAlive();
          }
        }
      });

      port.postMessage({ action: 'ping' });
    } catch {
      nativePort = null;
      nativeConnecting = false;
      if (currentSettings.enabled && !socket.isConnected) {
        socket.configure(currentSettings);
        socket.ensureAlive();
      }
    }
  }

  function disconnectNativeHost() {
    if (nativePort) {
      try {
        nativePort.disconnect();
      } catch {}
      nativePort = null;
    }
    nativeConnecting = false;
  }

  // ── settings & lifecycle ─────────────────────────────────────────────────
  function applySettings(s: Settings) {
    currentSettings = s;
    void updateStatus({ serverUrl: s.serverUrl, wsState: s.enabled ? wsState : 'disabled' });
    if (s.enabled) {
      ensureNativeHost();
      // Grace period fallback: if native host is already listening or in standalone mode
      setTimeout(() => {
        if (currentSettings.enabled && !socket.isConnected) {
          socket.configure(currentSettings);
          socket.ensureAlive();
        }
      }, 500);
    } else {
      disconnectNativeHost();
      socket.stop();
    }
  }

  void settingsItem.watch(() => {
    void getSettings().then(applySettings);
  });

  browser.alarms.create('bridge-keepalive', { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'bridge-keepalive' && currentSettings.enabled) {
      ensureNativeHost();
      socket.ensureAlive();
    }
  });

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void browser.runtime.openOptionsPage();
    }
  });

  // init
  void (async () => {
    const s = await getSettings();
    applySettings(s);
    const st = await statusItem.getValue();
    if (st.activeTaskId) await updateStatus({ activeTaskId: null });
    if (s.autoOpenChatGPT) await tabs.ensureTab().catch(() => {});
    await syncChatGPTTabStatus();
  })();
});
