import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ChatGPTBridge } from './host.js';
import type { BridgeLogger } from './types.js';

export interface BridgeServerOptions {
  port?: number;
  host?: string;
  token?: string;
  logger?: BridgeLogger;
}

export interface BridgeServerInstance {
  server: http.Server;
  bridge: ChatGPTBridge;
  port: number;
  host: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function createBridgeServer(options: BridgeServerOptions = {}): BridgeServerInstance {
  const port = options.port ?? 8787;
  const host = options.host ?? '127.0.0.1';

  let bridge: ChatGPTBridge;

  const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${host}:${port}`);

    // Helper to read JSON body
    const readJson = async (): Promise<any> => {
      let body = '';
      for await (const chunk of req) body += chunk;
      return body ? JSON.parse(body) : {};
    };

    // 1. Serve HTML Documentation & AI Agent Hub
    if (
      req.method === 'GET' &&
      (url.pathname === '/docs' ||
        url.pathname === '/docs.html' ||
        url.pathname === '/api-docs' ||
        (url.pathname === '/' && req.headers.accept?.includes('text/html')))
    ) {
      const candidates = [
        path.resolve(process.cwd(), 'public/docs.html'),
        path.resolve(process.cwd(), '../public/docs.html'),
        path.resolve(import.meta.dirname ?? '', '../../public/docs.html'),
        path.resolve(import.meta.dirname ?? '', '../public/docs.html'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const html = fs.readFileSync(p, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
      }
    }

    // Serve static assets (logo, icons) for docs
    if (req.method === 'GET' && (url.pathname === '/logo.png' || url.pathname.startsWith('/icon/'))) {
      const relPath = url.pathname.slice(1);
      const candidates = [
        path.resolve(process.cwd(), 'public', relPath),
        path.resolve(process.cwd(), '../public', relPath),
        path.resolve(import.meta.dirname ?? '', '../../public', relPath),
      ];
      for (const filePath of candidates) {
        if (fs.existsSync(filePath)) {
          const mime = url.pathname.endsWith('.png') ? 'image/png' : 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': mime });
          res.end(fs.readFileSync(filePath));
          return;
        }
      }
    }

    // 2. Health / Status check
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health' || url.pathname === '/status')) {
      const isConnected = bridge.isExtensionConnected();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify(
          {
            status: 'ok',
            extensionConnected: isConnected,
            extensionInfo: bridge.getExtensionInfo(),
            message: isConnected
              ? 'Browser extension is connected and ready!'
              : 'Browser extension is not connected. Enable the bridge toggle in the extension popup.',
            endpoints: {
              'GET /docs': 'Interactive HTML documentation & AI agent prompt hub',
              'POST /ask': 'Simple REST endpoint { prompt, newChat, stream }',
              'POST /v1/chat/completions': 'OpenAI-compatible endpoint',
              'POST /new-chat': 'Reset to a fresh chat conversation',
              'POST /cancel': 'Cancel any active generation task',
              'POST /reload-tab': 'Reload the active ChatGPT tab',
              'POST /reload-extension': 'Reload the unpacked extension in Chrome',
              'GET /diagnostics': 'Live page DOM selectors diagnostics',
              'GET /last-response': 'Get raw markdown of last assistant message',
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    if (url.pathname === '/reload-tab') {
      try {
        const resData = await (bridge as any).call('chatgpt.reloadTab');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resData));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/diagnostics') {
      try {
        const diag = await bridge.diagnostics();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(diag, null, 2));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, code: err.code }));
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/last-response') {
      try {
        const last = await bridge.getLastResponse();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(last, null, 2));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, code: err.code }));
      }
      return;
    }

    // 2. Simple REST endpoint: POST /ask
    if (req.method === 'POST' && url.pathname === '/ask') {
      if (!bridge.isExtensionConnected()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Browser extension is not connected. Make sure Chrome is open and Enable bridge is toggled ON.',
          }),
        );
        return;
      }

      try {
        const body = await readJson();
        const prompt = body.prompt ?? body.message;
        if (!prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "prompt" or "message" in JSON body' }));
          return;
        }

        // Streaming SSE support
        if (body.stream === true) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });

          const result = await bridge.ask(prompt, {
            newChat: body.newChat === true,
            onDelta: (delta) => {
              res.write(`data: ${JSON.stringify({ delta })}\n\n`);
            },
          });

          res.write(`data: ${JSON.stringify({ done: true, text: result.text, elapsedMs: result.elapsedMs })}\n\n`);
          res.end();
          return;
        }

        // Non-streaming response
        const result = await bridge.ask(prompt, {
          newChat: body.newChat === true,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result, null, 2));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, code: err.code }));
      }
      return;
    }

    // 3. OpenAI-compatible endpoint: POST /v1/chat/completions
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      if (!bridge.isExtensionConnected()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Extension not connected', type: 'extension_not_connected' } }));
        return;
      }

      try {
        const body = await readJson();
        const messages = body.messages ?? [];
        const userMessage = [...messages].reverse().find((m: any) => m.role === 'user')?.content ?? '';

        if (!userMessage) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'No user message found in messages array', type: 'invalid_request' } }));
          return;
        }

        const stream = body.stream === true;
        const completionId = `chatcmpl-${Date.now()}`;

        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });

          await bridge.ask(userMessage, {
            newChat: body.new_chat === true,
            onDelta: (delta) => {
              const chunk = {
                id: completionId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'chatgpt-web',
                choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            },
          });

          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        const result = await bridge.ask(userMessage, {
          newChat: body.new_chat === true,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: completionId,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'chatgpt-web',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: result.text },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          }),
        );
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err.message, type: err.code } }));
      }
      return;
    }

    // 4. Reset to new chat: POST /new-chat
    if (req.method === 'POST' && url.pathname === '/new-chat') {
      try {
        await bridge.newChat();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Started new chat' }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 5. Cancel active task: POST /cancel
    if (req.method === 'POST' && url.pathname === '/cancel') {
      try {
        const body = await readJson().catch(() => ({}));
        const resObj = await bridge.cancel(body.taskId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resObj ?? { ok: true }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // 6. Reload extension: POST /reload-extension
    if (req.method === 'POST' && url.pathname === '/reload-extension') {
      try {
        const resObj = await bridge.call('bridge.reloadExtension');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(resObj ?? { ok: true }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });

  bridge = new ChatGPTBridge({
    server,
    port,
    token: options.token,
    logger: options.logger,
  });

  return {
    server,
    bridge,
    port,
    host,
    start: async () => {
      await bridge.start();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
    },
    stop: async () => {
      await bridge.stop();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
