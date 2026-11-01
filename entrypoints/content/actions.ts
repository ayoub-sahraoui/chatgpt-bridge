import type { BridgeFile } from '../../lib/protocol';
import { ContentError } from './types';
import {
  getComposer,
  getSendButton,
  getStopButton,
  isLoggedIn,
  isVisible,
  queryOne,
  SELECTORS,
  sleep,
  waitForIdle,
  waitForSelector,
} from './dom';

/** Type a message into the composer (handles ProseMirror div and textarea). */
export async function setComposerText(text: string): Promise<void> {
  const composer = await waitForSelector('composer', 15_000);
  if (!isLoggedIn()) throw new ContentError('NOT_LOGGED_IN', 'ChatGPT asks you to log in in this tab');

  composer.focus();
  await sleep(50);

  if (composer instanceof HTMLTextAreaElement) {
    // React-controlled textarea: set the value through the native setter.
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(composer, text);
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // contenteditable (Lexical/ProseMirror): execCommand keeps internal state in sync.
  composer.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const ok = document.execCommand('insertText', false, text);
  if (!ok) {
    // very old fallback: paste-like input event
    composer.textContent = text;
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
  }
  await sleep(80);
}

function dataTransferFromFile(file: BridgeFile): File {
  const binary = atob(file.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], file.name || 'attachment', { type: file.mimeType || 'application/octet-stream' });
}

/**
 * Attach files to the composer. Prefers the hidden file input (most robust),
 * falls back to a synthetic paste event with clipboard files.
 */
export async function attachFiles(files: BridgeFile[]): Promise<'input' | 'paste'> {
  if (files.length === 0) return 'input';
  const payload = files.map(dataTransferFromFile);

  const input = queryOne('fileInput') as HTMLInputElement | null;
  if (input) {
    try {
      const dt = new DataTransfer();
      for (const f of payload) dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForSendEnabled(30_000);
      return 'input';
    } catch {
      // fall through to the paste strategy
    }
  }

  const composer = getComposer();
  if (!composer) throw new ContentError('COMPOSER_NOT_FOUND', 'Composer disappeared while attaching files');
  const dt = new DataTransfer();
  for (const f of payload) dt.items.add(f);
  const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
  composer.dispatchEvent(paste);
  await waitForSendEnabled(30_000);
  return 'paste';
}

function sendEnabled(): boolean {
  const btn = getSendButton();
  if (!btn) return false;
  if (btn.hasAttribute('disabled')) return false;
  if (btn.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

export async function waitForSendEnabled(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!sendEnabled()) {
    if (Date.now() > deadline) {
      throw new ContentError('SEND_FAILED', 'Send button never became available (upload stuck or message empty)');
    }
    await sleep(200);
  }
}

/** Click send; falls back to a synthetic Enter keypress on the composer. */
export async function clickSend(): Promise<void> {
  const composer = getComposer();
  const button = getSendButton();
  if (button && isVisible(button)) {
    composer?.focus();
    button.click();
    return;
  }
  if (composer) {
    composer.focus();
    const init: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    composer.dispatchEvent(new KeyboardEvent('keydown', init));
    composer.dispatchEvent(new KeyboardEvent('keypress', init));
    composer.dispatchEvent(new KeyboardEvent('keyup', init));
    return;
  }
  throw new ContentError('COMPOSER_NOT_FOUND', 'Nothing to send with (composer and button both missing)');
}

export async function stopGenerating(): Promise<void> {
  const stop = getStopButton();
  if (stop) stop.click();
}

/** Start a fresh conversation; waits for the composer to come back. */
export async function newChat(): Promise<void> {
  const btn = queryOne('newChatButton');
  if (btn) {
    btn.click();
  } else {
    // hard navigation always works, SPA or not
    location.assign('/');
    return;
  }
  await sleep(400);
  await waitForSelector('composer', 20_000);
}

export async function ensureIdleBeforeSend(waitMs = 120_000): Promise<void> {
  await waitForIdle(waitMs);
}

export function composerSelectableSnippet(): string {
  const el = queryOne('composer');
  if (!el) return '';
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}="${a.value}"`)
    .join(' ');
  return `<${el.tagName.toLowerCase()} ${attrs}`.slice(0, 300);
}

export const domInternals = { SELECTORS, isVisible, isLoggedIn };
