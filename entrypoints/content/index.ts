import { browser } from '#imports';
import { MESSAGE_TAG } from '../../lib/protocol';
import { PageAgent } from './agent';
import { ContentError } from './types';

export default defineContentScript({
  matches: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  runAt: 'document_idle',
  main() {
    const agent = new PageAgent();

    browser.runtime.onMessage.addListener(((msg: any, _sender: any, sendResponse: (r: unknown) => void) => {
      if (!msg || typeof msg !== 'object' || !msg[MESSAGE_TAG]) return false;
      void agent
        .handle(msg.method as string, msg.params)
        .then(
          (result) => sendResponse({ ok: true, result }),
          (err: unknown) =>
            sendResponse({
              ok: false,
              error:
                err instanceof ContentError
                  ? err.toShape()
                  : { code: (err as any)?.code ?? 'INTERNAL', message: String((err as any)?.message ?? err) },
            }),
        )
        .catch(() => {
          try {
            sendResponse({ ok: false, error: { code: 'INTERNAL', message: 'content script crashed' } });
          } catch {
            /* channel gone */
          }
        });
      return true; // keep the message channel open for the async reply
    }) as any);

    // Optional warm-up: fail fast in the console if selectors break.
    if (import.meta.env.DEV) {
      console.info('[chatgpt-bridge] content script loaded on', location.href);
    }
  },
});
