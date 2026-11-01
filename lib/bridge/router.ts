import { BRIDGE_VERSION, ERR, bridgeError } from '../protocol';
import type { SendParams } from '../protocol';
import { getSettings, updateStatus } from '../settings';
import { BridgeSocket } from './socket';
import { TabManager } from './tabs';

export interface RouterDeps {
  socket: BridgeSocket;
  tabs: TabManager;
  getWsState: () => { state: string; enabled: boolean; serverUrl: string };
  setActiveTask: (taskId: string | null) => Promise<void>;
  getActiveTask: () => string | null;
}

/** Routes incoming bridge.* / chatgpt.* requests (from WS or extension pages). */
export function createRouter(deps: RouterDeps) {
  const { tabs } = deps;

  return async function handleRequest(method: string, params: Record<string, unknown> | undefined): Promise<unknown> {
    if (method === 'bridge.ping') {
      return { pong: true, version: BRIDGE_VERSION };
    }

    if (method === 'bridge.getStatus') {
      const tab = await tabs.findChatGPTTab();
      let contentReady = false;
      if (tab?.id != null) {
        try {
          await tabs.forward(tab.id, 'page.ping', {}, 1500);
          contentReady = true;
        } catch {
          contentReady = false;
        }
      }
      const ws = deps.getWsState();
      return {
        enabled: ws.enabled,
        wsState: ws.state,
        serverUrl: ws.serverUrl,
        hasChatGPTTab: tab?.id != null,
        contentReady,
        activeTaskId: deps.getActiveTask(),
        version: BRIDGE_VERSION,
      };
    }

    if (method === 'bridge.reloadExtension') {
      setTimeout(() => {
        try {
          browser.runtime.reload();
        } catch {}
      }, 50);
      return { ok: true };
    }

    if (method === 'chatgpt.reloadTab') {
      const tab = await tabs.findChatGPTTab();
      if (tab?.id != null) {
        await tabs.reloadChatGPTTab(tab.id);
        return { ok: true, tabId: tab.id };
      }
      return { ok: false, error: 'No tab found' };
    }

    if (method === 'chatgpt.ensureTab') {
      const tab = await tabs.ensureTab();
      return { tabId: tab.id };
    }

    if (method.startsWith('chatgpt.')) {
      const tab = await tabs.ensureTab();
      if (tab.id == null) throw bridgeError(ERR.NO_TAB, 'ChatGPT tab has no id');

      if (method === 'chatgpt.send') {
        const settings = await getSettings();
        const sendParams: SendParams = {
          ...(params ?? {}),
          batchMs: settings.streamBatchMs,
          generationTimeoutMs: settings.generationTimeoutMs,
        };
        const result = (await tabs.forwardWithSetup(tab.id, method, sendParams as never, 120_000)) as {
          taskId: string;
        };
        await deps.setActiveTask(result.taskId);
        void updateStatus({ chatgptTabId: tab.id });
        return result;
      }

      const timeout = method === 'chatgpt.diagnostics' ? 60_000 : 30_000;
      const result = await tabs.forwardWithSetup(tab.id, method, params, timeout);
      if (method === 'chatgpt.getSession' && result && typeof result === 'object') {
        return { ...(result as Record<string, unknown>), tabId: tab.id };
      }
      return result;
    }

    throw bridgeError(ERR.UNKNOWN_METHOD, `Unknown method: ${method}`);
  };
}
