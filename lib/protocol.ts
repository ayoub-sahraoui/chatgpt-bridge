/**
 * Wire protocol shared by the extension (background/content) and the local SDK.
 *
 * Local app  ──(your code)──▶ SDK host (ws server, 127.0.0.1)
 *      SDK host ◀──WebSocket──▶ extension background (ws client)
 *           background ◀─runtime messages─▶ content script on chatgpt.com
 *
 * Every message crossing the WebSocket is one of:
 *   { type: 'hello', ... }            extension → server, first message
 *   { type: 'ping' } / { type:'pong'} heartbeat
 *   { type: 'req',   id, method, params }        server → extension
 *   { type: 'res',   id, ok, result|error }      extension → server
 *   { type: 'event', event, payload }            extension → server (push)
 */

export const BRIDGE_VERSION = '0.1.0';

export const MESSAGE_TAG = '__bridge'; // runtime message envelope tag
export const EVENT_TAG = '__bridgeEvent'; // content → background event envelope tag

export interface BridgeErrorShape {
  code: string;
  message: string;
}

export interface BridgeRequest {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface BridgeResponse {
  type: 'res';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: BridgeErrorShape;
}

export interface BridgeEventMsg {
  type: 'event';
  event: BridgeEventName | (string & {});
  payload?: unknown;
}

export interface BridgeHello {
  type: 'hello';
  client: 'chatgpt-bridge-extension';
  version: string;
  token?: string;
  extId: string;
}

export type WsState = 'disabled' | 'connecting' | 'connected' | 'disconnected';

/** User-editable extension settings (stored in storage.local). */
export interface Settings {
  enabled: boolean;
  /** ws:// URL of the local SDK host */
  serverUrl: string;
  /** shared secret checked against the hello message */
  token: string;
  autoReconnect: boolean;
  reconnectDelayMs: number;
  /** default timeout for request/response calls, ms */
  requestTimeoutMs: number;
  /** default overall timeout for one ask(), ms */
  askTimeoutMs: number;
  /** throttle for task.delta streaming, ms */
  streamBatchMs: number;
  /** hard cap for a single generation, ms */
  generationTimeoutMs: number;
  autoOpenChatGPT: boolean;
  theme: 'dark' | 'light' | 'system';
}

/** Live bridge status mirrored into storage so the popup can render it. */
export interface BridgeStatus {
  wsState: WsState;
  lastError: string | null;
  serverUrl: string;
  chatgptTabId: number | null;
  activeTaskId: string | null;
  updatedAt: number;
}

/** Task lifecycle events pushed from the extension to the SDK. */
export type BridgeEventName =
  | 'status.changed'
  | 'task.started'
  | 'task.delta'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled';

export interface TaskEventPayloads {
  'status.changed': Record<string, unknown>;
  'task.started': { taskId: string };
  'task.delta': { taskId: string; delta: string; text: string };
  'task.completed': { taskId: string; text: string; elapsedMs: number };
  'task.failed': { taskId: string; error: BridgeErrorShape };
  'task.cancelled': { taskId: string; text: string; elapsedMs: number };
}

/** File sent from a local app to be attached to the ChatGPT composer. */
export interface BridgeFile {
  name: string;
  mimeType: string;
  /** base64-encoded bytes */
  dataBase64: string;
}

export interface SendParams {
  message?: string;
  files?: BridgeFile[];
  stream?: boolean;
  newChat?: boolean;
  /** throttle for streamed deltas, ms (injected by background from settings) */
  batchMs?: number;
  /** hard cap for one generation, ms (injected by background from settings) */
  generationTimeoutMs?: number;
}

// ── Error codes ────────────────────────────────────────────────────────────
export const ERR = {
  NOT_CONNECTED: 'NOT_CONNECTED',
  NO_TAB: 'NO_TAB',
  CONTENT_TIMEOUT: 'CONTENT_TIMEOUT',
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  COMPOSER_NOT_FOUND: 'COMPOSER_NOT_FOUND',
  SEND_FAILED: 'SEND_FAILED',
  GENERATION_TIMEOUT: 'GENERATION_TIMEOUT',
  TASK_BUSY: 'TASK_BUSY',
  NO_TASK: 'NO_TASK',
  CANCELLED: 'CANCELLED',
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  TAB_CLOSED: 'TAB_CLOSED',
  UNKNOWN_METHOD: 'UNKNOWN_METHOD',
  UNAUTHORIZED: 'UNAUTHORIZED',
  TIMEOUT: 'TIMEOUT',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrCode = (typeof ERR)[keyof typeof ERR];

export function bridgeError(code: ErrCode | string, message: string): BridgeErrorShape {
  return { code, message };
}
