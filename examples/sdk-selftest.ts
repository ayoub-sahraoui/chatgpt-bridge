/**
 * SDK self-test against the mock extension — no browser needed.
 *
 * Terminal 1:  npm run mock -- --port 8790   (or: MOCK_PORT=8790 npm run mock)
 * Terminal 2:  npx tsx examples/sdk-selftest.ts
 */
import { ChatGPTBridge } from '@chatgpt-bridge/local-sdk';

const PORT = Number(process.env.SELFTEST_PORT ?? 8790);

async function main() {
  const bridge = new ChatGPTBridge({ port: PORT, logger: () => {} });
  await bridge.start();
  const hello = await bridge.waitForExtension(20_000);
  console.log('1. connected:', hello.client);

  const res = await bridge.ask('', {
    files: [{ name: 'test.pdf', base64: Buffer.from('hello pdf').toString('base64') }],
  });
  console.log('2. ask(files)  →', JSON.stringify(res.text));

  const { taskId } = await bridge.send('long running');
  const cancel = await bridge.cancel(taskId);
  const ev = await bridge.waitFor('task.cancelled', 5_000, (p) => p.taskId === taskId);
  console.log('3. cancel      →', JSON.stringify(cancel), 'event:', JSON.stringify(ev));

  console.log('4. status      →', JSON.stringify(await bridge.getStatus()));
  console.log('5. session     →', JSON.stringify(await bridge.getSession()));

  try {
    await bridge.call('chatgpt.nonexistent');
    console.log('6. FAIL — unknown method did not throw');
    process.exitCode = 1;
  } catch (e: any) {
    console.log('6. error codes →', e.code);
  }

  await bridge.stop();
  console.log('ALL OK');
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
