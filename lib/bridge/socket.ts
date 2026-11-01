import { browser } from '#imports';
import { BRIDGE_VERSION } from '../../lib/protocol';
import type { BridgeHello, BridgeRequest, BridgeResponse, WsState } from '../../lib/protocol';

type SettingsLike = {
  enabled: boolean;
  serverUrl: string;
  token: string;
  autoReconnect: boolean;
  reconnectDelayMs: number;
};

/**
 * WebSocket client living in the MV3 service worker. The local SDK host owns
 * the server side; we keep a reconnecting client connection to it and expose
 * hooks for request routing and event pushing.
 */
export class BridgeSocket {
  private ws: WebSocket | null = null;
  private state: WsState = 'disabled';
  private enabled = false;
  private settings: SettingsLike;
  private backoffMs = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastError: string | null = null;

  onRequest: ((req: BridgeRequest) => Promise<unknown>) | null = null;
  onStateChange: ((state: WsState, lastError: string | null) => void) | null = null;

  constructor(settings: SettingsLike) {
    this.settings = settings;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  configure(settings: SettingsLike): void {
    const needsRestart =
      settings.enabled !== this.enabled ||
      settings.serverUrl !== this.settings.serverUrl ||
      settings.token !== this.settings.token ||
      settings.autoReconnect !== this.settings.autoReconnect ||
      settings.reconnectDelayMs !== this.settings.reconnectDelayMs;
    this.settings = settings;
    if (!needsRestart) return;
    this.stopTimers();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close(1000, 'reconfigured');
      } catch {
        /* already closing */
      }
    }
    if (settings.enabled) {
      this.enabled = true;
      this.backoffMs = 0;
      this.connect();
    } else {
      this.enabled = false;
      this.setState('disabled');
    }
  }

  /** Re-establish the socket if it died unexpectedly (e.g. SW restart). */
  ensureAlive(): void {
    if (!this.enabled) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer) return;
    this.connect();
  }

  /** Immediately cancel backoff and reconnect (e.g. after server ready signal). */
  reconnectNow(): void {
    if (!this.enabled) return;
    this.stopTimers();
    this.backoffMs = 0;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close(1000, 'reconnectNow');
      } catch {}
    }
    this.connect();
  }

  stop(): void {
    this.enabled = false;
    this.stopTimers();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close(1000, 'disabled');
      } catch {
        /* noop */
      }
    }
    this.setState('disabled');
  }

  sendEvent(event: string, payload: unknown): void {
    this.send({ type: 'event', event, payload });
  }

  sendResponse(id: string, ok: boolean, result?: unknown, error?: { code: string; message: string }): void {
    const res: BridgeResponse = ok ? { type: 'res', id, ok, result } : { type: 'res', id, ok, error };
    this.send(res);
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (err) {
        this.lastError = `send failed: ${String(err)}`;
      }
    }
  }

  private connect(): void {
    if (!this.enabled) return;
    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.settings.serverUrl);
    } catch (err) {
      this.lastError = `invalid URL: ${String(err)}`;
      this.setState('disconnected');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoffMs = 0;
      this.lastError = null;
      const hello: BridgeHello = {
        type: 'hello',
        client: 'chatgpt-bridge-extension',
        version: BRIDGE_VERSION,
        token: this.settings.token || undefined,
        extId: browser.runtime.id,
      };
      ws.send(JSON.stringify(hello));
      this.setState('connected');
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      // keeps the MV3 service worker alive while the bridge is in use
      this.heartbeatTimer = setInterval(() => this.send({ type: 'ping' }), 25_000);
    };

    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg?.type === 'req') {
        void this.dispatch(msg as BridgeRequest);
      }
      // 'pong' and anything else: ignored
    };

    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopTimers();
      this.lastError = ev.reason || (ev.code === 1006 ? 'Server disconnected — reconnecting…' : `connection closed (${ev.code})`);
      this.setState('disconnected');
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      if (this.ws !== ws) return;
      this.lastError = `could not reach ${this.settings.serverUrl}`;
    };
  }

  private async dispatch(req: BridgeRequest): Promise<void> {
    if (!this.onRequest) {
      this.sendResponse(req.id, false, undefined, { code: 'INTERNAL', message: 'no router installed' });
      return;
    }
    try {
      const result = await this.onRequest(req);
      this.sendResponse(req.id, true, result);
    } catch (err: any) {
      const error =
        err && typeof err === 'object' && 'code' in err
          ? { code: String(err.code), message: String(err.message ?? err) }
          : { code: 'INTERNAL', message: String(err?.message ?? err) };
      this.sendResponse(req.id, false, undefined, error);
    }
  }

  private scheduleReconnect(): void {
    if (!this.enabled || !this.settings.autoReconnect) return;
    if (this.reconnectTimer) return;
    const base = this.settings.reconnectDelayMs || 2000;
    this.backoffMs = this.backoffMs === 0 ? base : Math.min(this.backoffMs * 1.7, 30_000);
    const delay = this.backoffMs + Math.random() * 500;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private stopTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private setState(state: WsState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state, this.lastError);
  }
}
