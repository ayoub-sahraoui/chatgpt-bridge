/**
 * Demo local app: connects to the extension through the SDK host and asks
 * ChatGPT a question, streaming the answer to stdout.
 *
 *   npm run demo -- --prompt "Explain MV3 service workers in one paragraph"
 *   npm run demo -- --prompt "What's in this file?" --file ./report.pdf
 *   npm run demo            # interactive REPL
 */
import { createInterface } from 'node:readline/promises';
import { ChatGPTBridge, fileFromPath } from '@chatgpt-bridge/local-sdk';

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompt' || a === '--port' || a === '--token' || a === '--timeout') {
      args[a.slice(2)] = argv[++i];
    } else if (a === '--file') {
      const prev = args.file;
      args.file = prev ? [...(prev as string[]), argv[++i]] : [argv[++i]];
    } else if (a === '--new-chat') {
      args['new-chat'] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = Number(args.port ?? 8787);
  const bridge = new ChatGPTBridge({
    port,
    token: typeof args.token === 'string' ? args.token : undefined,
    logger: (level, msg) => {
      if (level === 'info') console.log(`\x1b[2m${msg}\x1b[0m`);
      else if (level === 'warn' || level === 'error') console.warn(`\x1b[33m${msg}\x1b[0m`);
    },
  });

  await bridge.start();
  console.log(`✓ SDK host listening on ws://127.0.0.1:${port} — waiting for the extension…`);
  const hello = await bridge.waitForExtension(120_000);
  console.log(`✓ Extension connected: ${hello.client} v${hello.version} (${hello.extId})`);

  const ask = async (message: string, files: string[] = []) => {
    const inputs = files.map((f) => fileFromPath(f));
    console.log(`\n\x1b[1m you ▶\x1b[0m ${message}${inputs.length ? ` (+${inputs.length} file(s))` : ''}\n`);
    const answer = await bridge.ask(message, {
      files: inputs,
      newChat: args['new-chat'] === true,
      timeoutMs: args.timeout ? Number(args.timeout) : undefined,
      onDelta: (delta) => process.stdout.write(`\x1b[32m${delta}\x1b[0m`),
    });
    console.log(`\n\n\x1b[2m— ${answer.text.length} chars in ${(answer.elapsedMs / 1000).toFixed(1)}s —\x1b[0m\n`);
    return answer;
  };

  const prompt = args.prompt;
  if (typeof prompt === 'string') {
    const files = Array.isArray(args.file) ? args.file : args.file ? [args.file] : [];
    const answer = await ask(prompt, files);
    console.log(answer.text);
    await bridge.stop();
    return;
  }

  // Interactive REPL
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('Interactive mode — type a message, ":new" for a new chat, ":quit" to exit.\n');
  for (;;) {
    const line = (await rl.question('\x1b[1myou ▶\x1b[0m ')).trim();
    if (!line) continue;
    if (line === ':quit' || line === ':q') break;
    if (line === ':new') {
      await bridge.newChat();
      console.log('\x1b[2mstarted a new chat\x1b[0m');
      continue;
    }
    if (line === ':status') {
      console.log(JSON.stringify(await bridge.getStatus(), null, 2));
      continue;
    }
    try {
      await ask(line);
    } catch (err: any) {
      console.error(`\x1b[31m✕ ${err.code ?? 'ERROR'}: ${err.message}\x1b[0m`);
    }
  }
  rl.close();
  await bridge.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
