import { resolve } from 'node:path';
import { defineWebExtConfig } from 'wxt';

export default defineWebExtConfig({
  // Add chromiumProfile and keepProfileChanges here to reuse a local browser profile.
  chromiumArgs: [
    `--load-extension=${resolve('.output/chrome-mv3-dev')}`,
  ],
  startUrls: ['https://chatgpt.com'],
});
