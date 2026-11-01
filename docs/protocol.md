[← Back to the README](../README.md)

# Protocol reference

All messages on the WebSocket are JSON. After connecting, the extension sends a hello:

```json
{ "type": "hello", "client": "chatgpt-bridge-extension", "version": "0.1.0", "token": "…", "extId": "…" }
```

**Requests** (`server → extension`) and **responses** (`extension → server`):

```json
{ "type": "req", "id": "req-1-ab12", "method": "chatgpt.send", "params": { "message": "hi" } }
{ "type": "res", "id": "req-1-ab12", "ok": true, "result": { "taskId": "…" } }
{ "type": "res", "id": "req-1-ab12", "ok": false, "error": { "code": "TASK_BUSY", "message": "…" } }
```

**Events** (`extension → server`, pushed asynchronously):

```json
{ "type": "event", "event": "task.delta", "payload": { "taskId": "…", "delta": "He", "text": "He" } }
```

| Method | Result |
| --- | --- |
| `bridge.ping` | `{ pong, version }` |
| `bridge.getStatus` | `{ enabled, wsState, serverUrl, hasChatGPTTab, contentReady, activeTaskId, version }` |
| `chatgpt.ensureTab` | `{ tabId }` — opens a ChatGPT tab if none exists |
| `chatgpt.newChat` | starts a fresh conversation |
| `chatgpt.getSession` | `{ tabId, url, conversationId, loggedIn }` |
| `chatgpt.isBusy` | `{ busy }` |
| `chatgpt.send` | `{ taskId }` — params: `message`, `files: [{name, mimeType, dataBase64}]`, `stream`, `newChat` |
| `chatgpt.cancel` | `{ ok }` |
| `chatgpt.getLastResponse` | `{ text, url }` — markdown of the last assistant message |
| `chatgpt.diagnostics` | selector match report for the live page |

| Event | Payload |
| --- | --- |
| `task.started` | `{ taskId }` |
| `task.delta` | `{ taskId, delta, text }` (throttled, default 100 ms) |
| `task.completed` | `{ taskId, text, elapsedMs }` — final markdown |
| `task.failed` | `{ taskId, error: { code, message } }` |
| `task.cancelled` | `{ taskId, text, elapsedMs }` — partial text so far |
| `status.changed` | `{ wsState }` |

Error codes: `NOT_CONNECTED`, `NO_TAB`, `CONTENT_TIMEOUT`, `NOT_LOGGED_IN`, `COMPOSER_NOT_FOUND`, `SEND_FAILED`, `GENERATION_TIMEOUT`, `TASK_BUSY`, `UPLOAD_FAILED`, `TAB_CLOSED`, `TIMEOUT`, `UNKNOWN_METHOD`, `UNAUTHORIZED`, `INTERNAL`.

## How the automation works

The content script keeps a registry of selector fallbacks ([`entrypoints/content/dom.ts`](../entrypoints/content/dom.ts)): composer (`#prompt-textarea` ProseMirror or plain textarea), send/stop buttons, assistant messages, file inputs. For each task it:

1. Waits for the composer, waits out any in-flight generation.
2. Types via `execCommand('insertText')` (keeps ProseMirror state in sync) and attaches files through the hidden `input[type=file]` with a `DataTransfer` (paste-event fallback).
3. Clicks send and watches for the turn to start, then polls: Stop-button visible / `data-message-is-streaming` / text stability to decide completion.
4. Streams `task.delta` events (diff of the extracted markdown) and finishes with the full text converted back to markdown (headings, lists, fenced code with language, tables, links) by `entrypoints/content/markdown.ts`.

**When the ChatGPT UI changes**, run `chatgpt.diagnostics` (Options → Diagnostics, or `bridge.diagnostics()` from the SDK) — it reports which selectors still match so you know what to update.
