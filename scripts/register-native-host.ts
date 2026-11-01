import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

if (process.env.CI === 'true') {
  console.log('Skipping native host registration in CI.');
  process.exit(0);
}

const HOST_NAME = 'com.chatgpt.bridge.server';
const SCRIPT_PATH = path.resolve(import.meta.dirname, 'native-host.sh');

// Extension IDs to authorize
const ALLOWED_ORIGINS = [
  'chrome-extension://dpbdfmhkihmlgedgdeibejijjmpnlned/', // current dev extension ID
];

// Potential host directories on Linux
const targetDirs = [
  path.join(os.homedir(), '.config', 'google-chrome', 'NativeMessagingHosts'),
  path.join(os.homedir(), '.config', 'chromium', 'NativeMessagingHosts'),
];

const manifest = {
  name: HOST_NAME,
  description: 'ChatGPT Bridge Native Messaging Server',
  path: SCRIPT_PATH,
  type: 'stdio',
  allowed_origins: ALLOWED_ORIGINS,
};

let registeredCount = 0;

for (const dir of targetDirs) {
  // If parent browser config directory exists, create NativeMessagingHosts if needed
  const browserConfigDir = path.dirname(dir);
  if (fs.existsSync(browserConfigDir)) {
    fs.mkdirSync(dir, { recursive: true });
    const targetFile = path.join(dir, `${HOST_NAME}.json`);
    fs.writeFileSync(targetFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`✓ Registered native messaging host at: ${targetFile}`);
    registeredCount++;
  }
}

if (registeredCount === 0) {
  // Fallback: register in default google-chrome path
  const defaultDir = targetDirs[0]!;
  fs.mkdirSync(defaultDir, { recursive: true });
  const targetFile = path.join(defaultDir, `${HOST_NAME}.json`);
  fs.writeFileSync(targetFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`✓ Registered native messaging host at: ${targetFile}`);
}

console.log(`Native messaging host "${HOST_NAME}" points to "${SCRIPT_PATH}".`);
