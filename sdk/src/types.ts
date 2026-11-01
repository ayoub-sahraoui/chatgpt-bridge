/** Shared types for the ChatGPT Bridge local SDK. */

export interface SendFileInput {
  name: string;
  mimeType?: string;
  /** Raw bytes (Buffer) … */
  buffer?: Buffer | Uint8Array;
  /** … or already base64-encoded data. */
  base64?: string;
}

export interface SendOptions {
  files?: SendFileInput[];
  /** start a fresh conversation before sending */
  newChat?: boolean;
  /** receive streamed deltas (default true) */
  stream?: boolean;
  /** override ask/send timeout just for the wire call */
  callTimeoutMs?: number;
}

export interface AskOptions extends SendOptions {
  /** called with each streamed increment and the full text so far */
  onDelta?: (delta: string, fullText: string) => void;
  /** overall timeout for the answer; on timeout the task is cancelled (default 5 min) */
  timeoutMs?: number;
  /** abort externally */
  signal?: AbortSignal;
}

export interface SendResult {
  taskId: string;
}

export interface AskResult {
  taskId: string;
  text: string;
  elapsedMs: number;
}

export interface SessionInfo {
  tabId: number;
  url: string;
  conversationId: string | null;
  loggedIn: boolean;
}

export interface StatusInfo {
  enabled: boolean;
  wsState: string;
  serverUrl: string;
  hasChatGPTTab: boolean;
  contentReady: boolean;
  version: string;
  activeTaskId: string | null;
}

export interface BridgeTaskEvent {
  event:
    | 'task.started'
    | 'task.delta'
    | 'task.completed'
    | 'task.failed'
    | 'task.cancelled'
    | 'status.changed'
    | (string & {});
  payload: any;
}

export interface HelloInfo {
  client: string;
  version: string;
  extId: string;
}

export type BridgeLogger = (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: unknown) => void;

export interface HostOptions {
  /** WebSocket port to listen on (default 8787) */
  port?: number;
  /** bind address — keep the loopback default unless you know what you're doing */
  host?: string;
  /** shared secret the extension must send in its hello message */
  token?: string;
  /** max WS message size in bytes (files ride along base64-encoded) */
  maxPayload?: number;
  /** optional existing node:http Server to attach to */
  server?: any;
  /** default overall timeout for ask() (default 300_000) */
  askTimeoutMs?: number;
  /** default timeout for request/response calls (default 30_000) */
  callTimeoutMs?: number;
  logger?: BridgeLogger;
}

export class BridgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}
