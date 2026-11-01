import { storage } from '#imports';
import type { BridgeStatus, Settings, WsState } from './protocol';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  serverUrl: 'ws://127.0.0.1:8787',
  token: '',
  autoReconnect: true,
  reconnectDelayMs: 2000,
  requestTimeoutMs: 30_000,
  askTimeoutMs: 300_000,
  streamBatchMs: 100,
  generationTimeoutMs: 600_000,
  autoOpenChatGPT: true,
  theme: 'light',
};

export const DEFAULT_STATUS: BridgeStatus = {
  wsState: 'disabled',
  lastError: null,
  serverUrl: DEFAULT_SETTINGS.serverUrl,
  chatgptTabId: null,
  activeTaskId: null,
  updatedAt: 0,
};

export const settingsItem = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

export const statusItem = storage.defineItem<BridgeStatus>('local:status', {
  fallback: DEFAULT_STATUS,
});

/** Settings merged over defaults so new keys survive version upgrades. */
export async function getSettings(): Promise<Settings> {
  const stored = await settingsItem.getValue();
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function updateStatus(patch: Partial<BridgeStatus>): Promise<BridgeStatus> {
  const current = await statusItem.getValue();
  const next: BridgeStatus = { ...current, ...patch, updatedAt: Date.now() };
  await statusItem.setValue(next);
  return next;
}

export function statusLabel(state: WsState): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'disconnected':
      return 'Disconnected';
    default:
      return 'Disabled';
  }
}
