/**
 * Mock extension: pretends to be the ChatGPT Bridge extension so the SDK and
 * the demo agent can be tested without a browser. Answers chatgpt.send by
 * streaming back an echo of the request.
 *
 *   npm run mock                          # port 8787 (the SDK default)
 *   MOCK_PORT=8790 npm run mock           # custom port
 */
import { WebSocket } from 'ws';

const PORT = Number(process.env.MOCK_PORT ?? 8787);
const url = `ws://127.0.0.1:${PORT}`;

let activeTask: string | null = null;
let ws: WebSocket;

function connect(attempt = 0): void {
  const sock = new WebSocket(url);
  let opened = false;
  ws = sock;

  sock.on('open', () => {
    opened = true;
    sock.send(
      JSON.stringify({
        type: 'hello',
        client: 'chatgpt-bridge-extension',
        version: '0.0.0-mock',
        extId: 'mock-extension',
      }),
    );
    console.log(`[mock] connected to ${url} and said hello`);
  });

  sock.on('message', async (data) => {
    const msg = JSON.parse(String(data));
    if (msg.type !== 'req') return;
    console.log(`[mock] → ${msg.method}`, Object.keys(msg.params ?? {}));
    try {
      const result = await handle(msg.method, msg.params ?? {});
      send({ type: 'res', id: msg.id, ok: true, result });
    } catch (err: any) {
      send({
        type: 'res',
        id: msg.id,
        ok: false,
        error: { code: err.code ?? 'INTERNAL', message: String(err.message) },
      });
    }
  });

  sock.on('close', () => {
    // Only an established session ending is interesting; refused dials just retry.
    if (opened && ws === sock) {
      console.log('[mock] connection closed');
      process.exit(0);
    }
  });

  sock.on('error', (err) => {
    if (!opened && attempt < 40) {
      setTimeout(() => connect(attempt + 1), 500);
    } else if (!opened) {
      console.error(`[mock] could not reach ${url}: ${err.message}`);
      process.exit(1);
    }
  });
}

function send(msg: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function emit(event: string, payload: unknown) {
  send({ type: 'event', event, payload });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handle(method: string, params: any): Promise<unknown> {
  switch (method) {
    case 'bridge.ping':
      return { pong: true, version: '0.0.0-mock' };
    case 'bridge.getStatus':
      return {
        enabled: true,
        wsState: 'connected',
        serverUrl: url,
        hasChatGPTTab: true,
        contentReady: true,
        version: '0.0.0-mock',
        activeTaskId: activeTask,
      };
    case 'chatgpt.ensureTab':
      return { tabId: 1 };
    case 'chatgpt.newChat':
      return { ok: true };
    case 'chatgpt.getSession':
      return { tabId: 1, url: 'https://chatgpt.com/', conversationId: null, loggedIn: true };
    case 'chatgpt.isBusy':
      return { busy: activeTask != null };
    case 'chatgpt.getLastResponse':
      return { text: 'Mock: last response', url: 'https://chatgpt.com/' };
    case 'chatgpt.diagnostics':
      return { url: 'https://chatgpt.com/', mock: true, found: {} };
    case 'chatgpt.cancel': {
      if (activeTask && (!params.taskId || params.taskId === activeTask)) {
        const taskId = activeTask;
        activeTask = null;
        void (async () => {
          await sleep(120);
          emit('task.cancelled', { taskId, text: '(cancelled partial text)', elapsedMs: 120 });
        })();
        return { ok: true };
      }
      return { ok: false };
    }
    case 'chatgpt.send': {
      if (activeTask) throw Object.assign(new Error('busy'), { code: 'TASK_BUSY' });
      const taskId = `mock-${Date.now()}`;
      activeTask = taskId;
      void (async () => {
        await sleep(200);
        emit('task.started', { taskId });

        const fileNote = (params.files ?? []).map((f: any) => f.name).join(', ');
        const body = params.message
          ? `Echo: ${[...params.message].reverse().join('')}`
          : `Received ${params.files?.length ?? 0} file(s): ${fileNote}`;
        const full = params.newChat ? '[new chat] ' + body : body;

        // stream word by word
        let emitted = '';
        const chunks = full.match(/\S+\s*/g) ?? [full];
        for (const chunk of chunks) {
          await sleep(60);
          emitted += chunk;
          emit('task.delta', { taskId, delta: chunk, text: emitted });
        }
        await sleep(150);
        activeTask = null;
        emit('task.completed', { taskId, text: full, elapsedMs: 200 + chunks.length * 60 });
      })();
      return { taskId };
    }
    default:
      throw Object.assign(new Error(`mock does not implement ${method}`), { code: 'UNKNOWN_METHOD' });
  }
}

connect();
