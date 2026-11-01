/**
 * Selector registry for chatgpt.com. OpenAI ships UI changes without notice,
 * so every lookup goes through an ordered list of fallbacks and
 * `chatgpt.diagnostics` reports what actually matched.
 */

export const SELECTORS = {
  composer: [
    '#prompt-textarea',
    'div[contenteditable="true"]#prompt-textarea',
    'textarea[data-testid="prompt-textarea"]',
    'textarea#prompt-textarea',
    'main form div[contenteditable="true"]',
    'main div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][aria-label="Ask ChatGPT"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"]',
    'div[role="textbox"]',
    'main form textarea',
  ],
  sendButton: [
    '[data-testid="send-button"]',
    '[data-testid="fruitjuice-send-button"]',
    '#composer-submit-button',
    'button[aria-label*="Send"]',
    'button[aria-label*="send"]',
    'form button[type="submit"]',
    'form button:has(svg.icon-arrow-up)',
    'form button.size-token-button-composer',
  ],
  stopButton: [
    '[data-testid="stop-button"]',
    '[data-testid*="stop"]',
    'button[aria-label*="Stop streaming"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="stop"]',
    'form button:has(svg rect)',
    'form button:has(svg.icon-square)',
    'form button:has(rect)',
  ],
  assistantMessage: [
    '[data-message-author-role="assistant"]',
    '[class*="DilResponseRoot"]',
    '[class*="DilRenderer"]',
    '[class*="Renderer-"]',
    '.prose',
    'div[data-message-id]',
    '[data-testid^="conversation-turn"]:has(.markdown)',
    '[data-testid^="conversation-turn"]:has(.prose)',
    'article:has(.markdown)',
    'article:has(.prose)',
    '.agent-turn',
    '[data-testid^="conversation-turn-"]:not(:has([data-message-author-role="user"]))',
    'div.markdown',
  ],
  conversationTurn: [
    '[class*="DilResponseRoot"]',
    '[class*="DilRenderer"]',
    '[data-message-author-role="assistant"]',
    '[data-testid^="conversation-turn"]',
    'main article',
    'main div[data-message-id]',
    'main .prose',
    'button[aria-label*="Copy"]',
  ],
  newChatButton: ['[data-testid="create-new-chat-button"]', 'a[href="/"][data-sidebar]', 'a[aria-label="New chat"]'],
  loginButton: ['[data-testid="login-button"]', 'button[data-testid="welcome-login-button"]', 'a[href*="auth/login"]'],
  fileInput: ['main input[type="file"]', 'form input[type="file"]', 'input[type="file"]'],
  main: ['main'],
} as const;

export type SelectorGroup = keyof typeof SELECTORS;

export function queryAll(group: SelectorGroup): HTMLElement[] {
  const list: HTMLElement[] = [];
  for (const sel of SELECTORS[group]) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      if (!list.includes(el)) list.push(el);
    });
    if (list.length > 0 && group !== 'assistantMessage' && group !== 'conversationTurn') break;
  }
  return list;
}

export function queryOne(group: SelectorGroup): HTMLElement | null {
  for (const sel of SELECTORS[group]) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return null;
}

export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** First visible match, falling back to any match. */
export function getComposer(): HTMLElement | null {
  return queryOne('composer');
}

export function getSendButton(): HTMLElement | null {
  return queryOne('sendButton');
}

export function getStopButton(): HTMLElement | null {
  for (const sel of SELECTORS.stopButton) {
    const el = document.querySelector<HTMLElement>(sel);
    if (
      el &&
      isVisible(el) &&
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-disabled') !== 'true'
    ) {
      return el;
    }
  }
  return null;
}

export function getAssistantMessages(): HTMLElement[] {
  for (const sel of SELECTORS.assistantMessage) {
    const list = Array.from(document.querySelectorAll<HTMLElement>(sel));
    if (list.length > 0) return list;
  }
  return [];
}

export function getLastAssistant(): HTMLElement | null {
  const all = getAssistantMessages();
  const last = all[all.length - 1] ?? null;
  if (last) {
    const inner = last.querySelector<HTMLElement>('[class*="DilResponseRoot"], [class*="DilRenderer"], [class*="Renderer-"], .prose, .markdown');
    return inner ?? last;
  }
  const allContent = Array.from(document.querySelectorAll<HTMLElement>('[class*="DilResponseRoot"], [class*="DilRenderer"], [class*="Renderer-"], .prose, .markdown'));
  if (allContent.length > 0) {
    return allContent[allContent.length - 1] ?? null;
  }

  // Fallback: Find the last Copy button and take its assistant content container
  const copyBtns = Array.from(
    document.querySelectorAll<HTMLElement>(
      'button[aria-label*="Copy"], button[data-testid*="copy"], button[title*="Copy"]'
    )
  );
  if (copyBtns.length > 0) {
    const lastBtn = copyBtns[copyBtns.length - 1]!;
    let parent = lastBtn.parentElement;
    while (parent && parent.tagName !== 'MAIN' && parent.tagName !== 'BODY') {
      const content = parent.querySelector<HTMLElement>('[class*="DilResponseRoot"], [class*="DilRenderer"], [class*="Renderer-"], .prose, .markdown');
      if (content && (content.textContent?.trim().length ?? 0) > 0) {
        return content;
      }
      parent = parent.parentElement;
    }
  }

  // Fallback: Last paragraph in main
  const allP = Array.from(document.querySelectorAll<HTMLElement>('main p:not(form p, .ProseMirror p)'));
  if (allP.length > 0) {
    const lastP = allP[allP.length - 1]!;
    return (lastP.closest('div:has(p)') as HTMLElement) ?? lastP;
  }

  return null;
}

export function getConversationTurns(): HTMLElement[] {
  return queryAll('conversationTurn');
}

export function isLoggedIn(): boolean {
  return !queryOne('loginButton');
}

/** Heuristic: a generation is in flight while a visible Stop button exists. */
export function isGenerating(): boolean {
  if (getStopButton()) return true;
  const last = getLastAssistant();
  if (!last) return false;
  if (last.getAttribute('data-message-is-streaming') === 'true') return true;
  if (last.classList.contains('result-streaming')) return true;
  if (last.querySelector('.result-streaming')) return true;
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until one of the selector group's fallbacks matches. */
export async function waitForSelector(group: SelectorGroup, timeoutMs = 15_000): Promise<HTMLElement> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const el = queryOne(group);
    if (el) return el;
    if (Date.now() > deadline) {
      const found = Object.fromEntries(
        (Object.keys(SELECTORS) as SelectorGroup[]).map((g) => [g, queryOne(g)?.tagName ?? null]),
      );
      throw Object.assign(new Error(`Selector group '${group}' not found within ${timeoutMs}ms`), {
        code: group === 'composer' ? 'COMPOSER_NOT_FOUND' : 'INTERNAL',
        found,
      });
    }
    await sleep(150);
  }
}

/** Wait until the page stops generating (and stays stopped). */
export async function waitForIdle(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isGenerating()) {
    if (Date.now() > deadline) throw Object.assign(new Error('Page never went idle'), { code: 'GENERATION_TIMEOUT' });
    await sleep(250);
  }
}
