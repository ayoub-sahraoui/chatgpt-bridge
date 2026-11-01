import { createBridgeServer } from '@chatgpt-bridge/local-sdk';

const PORT = Number(process.env.PORT ?? 8787);

const bridgeServer = createBridgeServer({
  port: PORT,
  logger: (level, msg) => {
    if (level === 'info') console.log(`\x1b[36m[bridge]\x1b[0m ${msg}`);
    else if (level === 'warn') console.warn(`\x1b[33m[bridge:warn]\x1b[0m ${msg}`);
    else if (level === 'error') console.error(`\x1b[31m[bridge:error]\x1b[0m ${msg}`);
  },
});

await bridgeServer.start();

console.log(`\n\x1b[1;32m✓ ChatGPT Bridge REST API is running on http://127.0.0.1:${PORT}\x1b[0m\n`);
console.log(`  • REST call:      curl -X POST http://127.0.0.1:${PORT}/ask -H "Content-Type: application/json" -d '{"prompt":"hello"}'`);
console.log(`  • OpenAI API:     http://127.0.0.1:${PORT}/v1 (compatible with OpenAI clients)`);
console.log(`  • Health check:   http://127.0.0.1:${PORT}/health`);
console.log(`  • Extension WS:   ws://127.0.0.1:${PORT} (ready for extension connection)\n`);
