import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  browser: 'chrome',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'ChatGPT Bridge',
    description:
      'Bridge that lets local apps drive the ChatGPT web UI: send messages, upload files, stream and parse responses.',
    permissions: ['storage', 'tabs', 'alarms', 'nativeMessaging', 'activeTab', 'scripting'],
    host_permissions: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    web_accessible_resources: [{
      resources: ['popup.html'],
      matches: ['http://*/*', 'https://*/*'],
      use_dynamic_url: true,
    }],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    browser_specific_settings: {
      gecko: {
        id: 'chatgpt-bridge@local',
        strict_min_version: '109.0',
      },
    },
  },
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      // Keep popup.html for the embedded panel and restricted-page fallback.
      if (manifest.action) delete manifest.action.default_popup;
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
