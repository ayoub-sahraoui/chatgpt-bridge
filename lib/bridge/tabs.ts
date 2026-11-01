import { browser } from '#imports';
import { ERR, bridgeError } from '../protocol';
import { MESSAGE_TAG } from '../protocol';

/** Minimal structural view of a tab — avoids depending on wrapper generics. */
interface ChatGPTTab {
  id?: number | null;
  active?: boolean;
  lastAccessed?: number;
  status?: string;
}

const CHATGPT_URL_PATTERNS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
export const CHATGPT_HOME = 'https://chatgpt.com/';

/**
 * Finds (or opens) the ChatGPT tab and shuttles requests to the content
 * script living in it.
 */
export class TabManager {
  private cachedTabId: number | null = null;

  async findChatGPTTab(): Promise<ChatGPTTab | null> {
    const tabs = await browser.tabs.query({ url: CHATGPT_URL_PATTERNS });
    if (tabs.length === 0) {
      this.cachedTabId = null;
      return null;
    }
    const active = tabs.find((t) => t.active && t.id != null);
    const best = active ?? tabs.filter((t) => t.id != null).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
    this.cachedTabId = best?.id ?? null;
    return best ?? null;
  }

  async ensureTab(): Promise<ChatGPTTab> {
    const existing = await this.findChatGPTTab();
    if (existing?.id != null) {
      try {
        const res = await this.forward(existing.id, 'page.ping', {}, 1500);
        if (res && (res as any).ready) return existing;
      } catch {
        // Tab exists but content script is detached (e.g. extension updated/reloaded).
        // Reload tab to attach fresh content script.
        try {
          await browser.tabs.reload(existing.id);
          await this.waitForTabComplete(existing.id, 30_000);
          await this.waitForContentReady(existing.id, 20_000);
          return existing;
        } catch {
          // Fallback to creating a new tab if reload fails
        }
      }
    }

    const created = await browser.tabs.create({ url: CHATGPT_HOME, active: false });
    if (created.id == null) throw bridgeError(ERR.NO_TAB, 'Failed to open a ChatGPT tab');
    await this.waitForTabComplete(created.id, 30_000);
    await this.waitForContentReady(created.id, 20_000);
    return created;
  }

  async reloadChatGPTTab(tabId: number): Promise<void> {
    await browser.tabs.reload(tabId);
    await this.waitForTabComplete(tabId, 30_000);
    await this.waitForContentReady(tabId, 20_000);
  }

  waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(bridgeError(ERR.CONTENT_TIMEOUT, 'ChatGPT tab did not finish loading'));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(onUpdated);
      };
      const onUpdated = (id: number, info: { status?: string }) => {
        if (id === tabId && info.status === 'complete') {
          cleanup();
          resolve();
        }
      };
      browser.tabs.onUpdated.addListener(onUpdated);
      // already complete?
      void browser.tabs.get(tabId).then((tab) => {
        if (tab.status === 'complete') {
          cleanup();
          resolve();
        }
      });
    });
  }

  /** Poll the content script until it answers pings. */
  async waitForContentReady(tabId: number, timeoutMs = 15_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      try {
        const res = await this.forward(tabId, 'page.ping', {}, 2000);
        if (res && (res as any).ready) return;
      } catch (err) {
        lastErr = err;
      }
      await sleep(300);
    }
    const errMsg = lastErr instanceof Error ? lastErr.message : (lastErr as any)?.message ?? String(lastErr ?? 'unknown error');
    throw bridgeError(
      ERR.CONTENT_TIMEOUT,
      `Content script not ready: ${errMsg}`,
    );
  }

  /** Send one request to the content script and await its full response. */
  async forward(
    tabId: number,
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    const id = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = { [MESSAGE_TAG]: true, id, method, params };
    const result = await Promise.race([
      browser.tabs.sendMessage(tabId, payload).catch((err: unknown) => {
        throw this.mapForwardError(err, tabId);
      }),
      sleep(timeoutMs).then(() => {
        throw bridgeError(ERR.CONTENT_TIMEOUT, `content script did not answer '${method}' within ${timeoutMs}ms`);
      }),
    ]);
    const res = result as { ok?: boolean; result?: unknown; error?: { code: string; message: string } };
    if (res?.ok) return res.result;
    throw res?.error ?? bridgeError(ERR.INTERNAL, 'Unknown content script error');
  }

  /** Forward with one automatic retry after making sure content is ready. */
  async forwardWithSetup(tabId: number, method: string, params: Record<string, unknown> | undefined, timeoutMs: number) {
    try {
      return await this.forward(tabId, method, params, timeoutMs);
    } catch (err: any) {
      if (err?.code === ERR.CONTENT_TIMEOUT || err?.code === ERR.TAB_CLOSED) {
        // Content script was disconnected (e.g. extension updated/reloaded); reload tab and retry
        try {
          await browser.tabs.reload(tabId);
          await this.waitForTabComplete(tabId, 30_000);
          await this.waitForContentReady(tabId, 20_000);
          return await this.forward(tabId, method, params, timeoutMs);
        } catch (retryErr) {
          throw retryErr;
        }
      }
      throw err;
    }
  }

  private mapForwardError(err: unknown, tabId: number): { code: string; message: string } {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Could not establish connection|Receiving end does not exist/i.test(msg)) {
      return bridgeError(ERR.CONTENT_TIMEOUT, 'Content script is not running in the ChatGPT tab yet');
    }
    if (/No tab with id|tab was closed|cannot be edited/i.test(msg)) {
      if (this.cachedTabId === tabId) this.cachedTabId = null;
      return bridgeError(ERR.TAB_CLOSED, 'The ChatGPT tab was closed');
    }
    return bridgeError(ERR.INTERNAL, msg);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
