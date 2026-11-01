import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  AskOptions,
  AskResult,
  BridgeError,
  BridgeTaskEvent,
  HelloInfo,
  HostOptions,
  SendFileInput,
  SendOptions,
  SendResult,
  SessionInfo,
  StatusInfo,
} from './types.js';

interface PendingCall {
  resolve: (value: any) => void;
  reject: (err: BridgeError) => void;
  timer: NodeJS.Timeout;
}

const defaultLogger = (level: string, message: string) => {
  const line = `[chatgpt-bridge] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

/**
 * Local WebSocket host that the ChatGPT Bridge extension connects to.
 *
 * ```ts
 * const bridge = new ChatGPTBridge({ port: 8787 });
 * await bridge.start();
 * await bridge.waitForExtension();
 * const answer = await bridge.ask('Summarize this', { onDelta: d => process.stdout.write(d) });
 * ```
 */
export class ChatGPTBridge {
  private readonly opts: Required<Pick<HostOptions, 'port' | 'host' | 'maxPayload' | 'askTimeoutMs' | 'callTimeoutMs'>> &
    HostOptions;
  private readonly log: NonNullable<HostOptions['logger']>;
  private readonly events = new EventEmitter();
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private hello: HelloInfo | null = null;
  private pending = new Map<string, PendingCall>();
  private reqCounter = 0;
  private heartbeat: NodeJS.Timeout | null = null;
  private started = false;

  constructor(options: HostOptions = {}) {
    this.opts = {
      port: options.port ?? 8787,
      host: options.host ?? '127.0.0.1',
      maxPayload: options.maxPayload ?? 128 * 1024 * 1024,
      askTimeoutMs: options.askTimeoutMs ?? 300_000,
      callTimeoutMs: options.callTimeoutMs ?? 30_000,
      token: options.token,
      logger: options.logger,
      server: options.server,
    };
    this.log = options.logger ?? defaultLogger;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.started) return;
    await new Promise<void>((resolve, reject) => {
      if (this.opts.server) {
        this.wss = new WebSocketServer({
          server: this.opts.server,
          maxPayload: this.opts.maxPayload,
        });
        this.wss.once('error', reject);
        this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
        this.started = true;
        this.log('info', `attached WebSocket server to HTTP host`);
        resolve();
      } else {
        this.wss = new WebSocketServer({
          host: this.opts.host,
          port: this.opts.port,
          maxPayload: this.opts.maxPayload,
        });
        this.wss.once('error', reject);
        this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
        this.wss.once('listening', () => {
          this.started = true;
          this.log('info', `listening on ws://${this.opts.host}:${this.opts.port}`);
          resolve();
        });
      }
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError('NOT_CONNECTED', 'SDK host stopped'));
    }
    this.pending.clear();
    this.socket?.close(1001, 'host stopping');
    this.socket = null;
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    this.wss = null;
    this.started = false;
    this.hello = null;
  }

  // ── connection state ─────────────────────────────────────────────────────

  isExtensionConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  getExtensionInfo(): HelloInfo | null {
    return this.hello ? { ...this.hello } : null;
  }

  /** Resolves once the extension has completed its hello handshake. */
  async waitForExtension(timeoutMs = 60_000): Promise<HelloInfo> {
    if (this.hello && this.isExtensionConnected()) return { ...this.hello };
    return new Promise<HelloInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new BridgeError('TIMEOUT', `Extension did not connect within ${timeoutMs}ms`));
      }, timeoutMs);
      const off = this.on('extension.connected', ({ hello }: { hello: HelloInfo }) => {
        clearTimeout(timer);
        off();
        resolve(hello);
      });
      // Re-check after subscribing so a connection that slipped in during
      // setup is not missed.
      if (this.hello && this.isExtensionConnected()) {
        clearTimeout(timer);
        off();
        resolve({ ...this.hello });
      }
    });
  }

  on(event: string, cb: (payload: any) => void): () => void {
    this.events.on(event, cb);
    return () => this.events.off(event, cb);
  }

  /** Resolves with the next event matching `predicate`. */
  waitFor(event: string, timeoutMs?: number, predicate?: (payload: any) => boolean): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs != null
          ? setTimeout(() => {
              cleanup();
              reject(new BridgeError('TIMEOUT', `Timed out waiting for event: ${event}`));
            }, timeoutMs)
          : null;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.events.off(event, handler);
      };
      const handler = (payload: any) => {
        if (predicate && !predicate(payload)) return;
        cleanup();
        resolve(payload);
      };
      this.events.on(event, handler);
    });
  }

  // ── high-level API ───────────────────────────────────────────────────────

  ping(): Promise<{ pong: boolean; version: string }> {
    return this.call('bridge.ping');
  }

  getStatus(): Promise<StatusInfo> {
    return this.call('bridge.getStatus');
  }

  /** Make sure a ChatGPT tab exists (opens one otherwise). */
  ensureTab(): Promise<{ tabId: number }> {
    return this.call('chatgpt.ensureTab');
  }

  newChat(): Promise<{ tabId: number }> {
    return this.call('chatgpt.newChat');
  }

  getSession(): Promise<SessionInfo> {
    return this.call('chatgpt.getSession');
  }

  isBusy(): Promise<{ busy: boolean }> {
    return this.call('chatgpt.isBusy');
  }

  /** Raw markdown of the most recent assistant message in the active tab. */
  getLastResponse(): Promise<{ text: string | null; url: string }> {
    return this.call('chatgpt.getLastResponse');
  }

  diagnostics(): Promise<Record<string, unknown>> {
    return this.call('chatgpt.diagnostics');
  }

  /**
   * Start a task: send a message (with optional file attachments) and return
   * its taskId immediately. Subscribe to task.* events for progress.
   */
  async send(message: string, options: SendOptions = {}): Promise<SendResult> {
    const params = {
      message,
      files: (options.files ?? []).map(serializeFile),
      newChat: options.newChat ?? false,
      stream: options.stream ?? true,
    };
    const res = await this.call<{ taskId: string }>('chatgpt.send', params, {
      timeoutMs: options.callTimeoutMs ?? 120_000,
    });
    return { taskId: res.taskId };
  }

  /** Same as send() for the `files` type. */
  async sendFiles(files: SendFileInput[], options: SendOptions = {}): Promise<SendResult> {
    return this.send('', { ...options, files });
  }

  /**
   * Send a message and wait for the full answer.
   * Streams deltas to `options.onDelta` and cancels the task on timeout.
   */
  async ask(message: string, options: AskOptions = {}): Promise<AskResult> {
    if (!this.isExtensionConnected()) {
      throw new BridgeError('NOT_CONNECTED', 'Extension is not connected (start it and call waitForExtension)');
    }
    const timeoutMs = options.timeoutMs ?? this.opts.askTimeoutMs;
    const started = Date.now();
    const { taskId } = await this.send(message, options);

    let finished = false;
    const unsubscribe = this.on(`task.delta`, (p: any) => {
      if (p?.taskId !== taskId || finished) return;
      options.onDelta?.(p.delta, p.text);
    });

    const timeout = setTimeout(async () => {
      if (finished) return;
      this.log('warn', `ask(${taskId}) timed out after ${timeoutMs}ms — cancelling`);
      this.cancel(taskId).catch(() => {});
    }, timeoutMs);
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        if (!finished) this.cancel(taskId).catch(() => {});
      });
    }

    try {
      const terminal = await new Promise<{ kind: 'completed' | 'cancelled' | 'failed'; payload: any }>(
        (resolve, reject) => {
          const offs = (['task.completed', 'task.cancelled', 'task.failed'] as const).map((evt) =>
            this.on(evt, (payload: any) => {
              if (payload?.taskId !== taskId) return;
              offs.forEach((off) => off());
              resolve({ kind: evt.split('.')[1] as 'completed' | 'cancelled' | 'failed', payload });
            }),
          );
        },
      );

      if (terminal.kind === 'failed') {
        throw new BridgeError(terminal.payload.error?.code ?? 'INTERNAL', terminal.payload.error?.message ?? 'Task failed');
      }
      return {
        taskId,
        text: terminal.payload.text ?? '',
        elapsedMs: terminal.payload.elapsedMs ?? Date.now() - started,
      };
    } finally {
      finished = true;
      clearTimeout(timeout);
      unsubscribe();
    }
  }

  cancel(taskId: string): Promise<{ ok: boolean }> {
    return this.call('chatgpt.cancel', { taskId });
  }

  // ── request/response core ────────────────────────────────────────────────

  async call<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts: { timeoutMs?: number } = {},
  ): Promise<T> {
    const ws = this.socket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new BridgeError('NOT_CONNECTED', 'Extension is not connected');
    }
    const id = `req-${++this.reqCounter}-${randomUUID().slice(0, 8)}`;
    const timeoutMs = opts.timeoutMs ?? this.opts.callTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError('TIMEOUT', `Extension did not answer '${method}' within ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.rawSend(ws, { type: 'req', id, method, params });
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private onConnection(ws: WebSocket, req: { socket: { remoteAddress?: string } }) {
    // Only one extension session at a time: the newest wins.
    if (this.socket && this.socket !== ws) {
      this.log('info', 'replacing existing extension connection');
      this.teardownSocket(this.socket, 'replaced');
    }
    this.socket = ws;
    this.hello = null;
    this.log('info', `extension socket opened from ${req.socket.remoteAddress ?? 'unknown'}`);
    this.startHeartbeat(ws);

    ws.on('message', (data: RawData) => this.onMessage(ws, data));
    ws.on('close', (code, reason) => {
      if (this.socket === ws) this.teardownSocket(ws, `closed ${code} ${reason || ''}`.trim());
    });
    ws.on('error', (err) => this.log('warn', `socket error: ${err.message}`));
  }

  private onMessage(ws: WebSocket, data: RawData) {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      this.log('warn', 'dropping malformed message (invalid JSON)');
      return;
    }
    switch (msg?.type) {
      case 'hello': {
        if (this.opts.token && msg.token !== this.opts.token) {
          this.log('warn', 'rejecting extension: bad token');
          ws.close(4001, 'unauthorized');
          return;
        }
        this.hello = { client: msg.client, version: msg.version, extId: msg.extId };
        this.log('info', `extension connected: ${msg.client} v${msg.version} (${msg.extId})`);
        this.events.emit('extension.connected', { hello: this.hello });
        break;
      }
      case 'res': {
        const p = this.pending.get(msg.id);
        if (!p) break;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new BridgeError(msg.error?.code ?? 'INTERNAL', msg.error?.message ?? 'Unknown bridge error'));
        break;
      }
      case 'event': {
        // meta-channel for on('event', …) consumers, then the named channel
        this.events.emit('event', { event: msg.event, payload: msg.payload } satisfies BridgeTaskEvent);
        this.events.emit(msg.event, msg.payload);
        break;
      }
      case 'pong':
        break;
      default:
        this.log('debug' as never, `ignoring message type: ${msg?.type}`);
    }
  }

  private startHeartbeat(ws: WebSocket) {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping();
    }, 20_000);
  }

  private teardownSocket(ws: WebSocket, reason: string) {
    if (this.socket === ws) {
      this.socket = null;
      this.hello = null;
      this.events.emit('extension.disconnected', { reason });
      this.log('info', `extension disconnected (${reason})`);
    }
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new BridgeError('NOT_CONNECTED', 'Extension disconnected'));
    }
    this.pending.clear();
  }

  private rawSend(ws: WebSocket, msg: unknown) {
    ws.send(JSON.stringify(msg));
  }
}

function serializeFile(f: SendFileInput) {
  if (!f.name) throw new BridgeError('INTERNAL', 'File input is missing a name');
  if (f.base64 != null) return { name: f.name, mimeType: f.mimeType ?? 'application/octet-stream', dataBase64: f.base64 };
  if (f.buffer != null) {
    const buf = Buffer.isBuffer(f.buffer) ? f.buffer : Buffer.from(f.buffer);
    return { name: f.name, mimeType: f.mimeType ?? 'application/octet-stream', dataBase64: buf.toString('base64') };
  }
  throw new BridgeError('INTERNAL', `File '${f.name}' has neither buffer nor base64 data`);
}
