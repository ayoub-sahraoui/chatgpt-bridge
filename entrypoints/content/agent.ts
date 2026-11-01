import { browser } from '#imports';
import { EVENT_TAG, ERR } from '../../lib/protocol';
import type { SendParams } from '../../lib/protocol';
import * as dom from './dom';
import * as actions from './actions';
import { extractMarkdown } from './markdown';
import { ContentError } from './types';
import type { DiagnosticsInfo, SendTaskParams, TaskEvent } from './types';

const sleep = dom.sleep;

/** Runs one send → stream → parse cycle against the live ChatGPT tab. */
class TaskRunner {
  /** Rejects if the task fails at any point (also emits task.failed once). */
  readonly finished: Promise<void>;
  /** Resolves once the message was accepted by ChatGPT (task.started emitted). */
  readonly ready: Promise<void>;
  private aborted = false;
  private lastEmitted = '';
  private lastText = '';

  constructor(
    readonly taskId: string,
    private params: SendTaskParams,
    private emitEvent: (event: TaskEvent['event'], payload: Record<string, unknown>) => void,
  ) {
    this.finished = new Promise<void>((resolve, reject) => {
      this.resolveFinished = resolve;
      this.rejectFinished = reject;
    });
    // Emit failures as events; keep the rejection reachable for callers.
    this.finished.catch((err) => this.fail(err));
    this.ready = new Promise<void>((resolve) => (this.resolveReady = resolve));
    void this.run().then(
      () => this.resolveFinished(),
      (err) => this.rejectFinished(err),
    );
  }

  private resolveFinished!: () => void;
  private rejectFinished!: (err: unknown) => void;
  private resolveReady!: () => void;

  abort(): void {
    this.aborted = true;
  }

  private async run(): Promise<void> {
    const t0 = Date.now();
    const p = this.params;

    if (!dom.isLoggedIn()) {
      throw new ContentError(ERR.NOT_LOGGED_IN, 'ChatGPT is showing a login screen — sign in inside the extension-driven tab');
    }
    try {
      await dom.waitForSelector('composer', 20_000);
    } catch (err: any) {
      throw new ContentError(
        ERR.COMPOSER_NOT_FOUND,
        `Composer not found${err?.found ? ` (page selectors: ${JSON.stringify(err.found)})` : ''} — run chatgpt.diagnostics`,
      );
    }

    if (p.newChat) await actions.newChat();

    // Politely wait out any in-flight generation before typing.
    try {
      await dom.waitForIdle(180_000);
    } catch {
      /* send will surface the real problem */
    }
    if (this.aborted) return this.cancelled(Date.now() - t0);

    if (p.message) await actions.setComposerText(p.message);
    if (p.files?.length) await actions.attachFiles(p.files);
    if (this.aborted) return this.cancelled(Date.now() - t0);

    const assistantsBefore = dom.getAssistantMessages().length;
    const turnsBefore = dom.getConversationTurns().length;
    const previousLastEl = dom.getLastAssistant();
    const previousLastText = previousLastEl ? extractMarkdown(previousLastEl) : '';

    await actions.waitForSendEnabled(30_000);
    await actions.clickSend();
    this.emitEvent('task.started', { taskId: this.taskId });
    this.resolveReady();

    await this.watch(assistantsBefore, turnsBefore, previousLastText, t0);
  }

  private async watch(
    assistantsBefore: number,
    turnsBefore: number,
    previousLastText: string,
    t0: number,
  ): Promise<void> {
    const stream = this.params.stream !== false;
    const batchMs = Math.max(30, this.params.batchMs ?? 100);
    const genTimeoutMs = this.params.generationTimeoutMs ?? 600_000;
    const deadline = Date.now() + genTimeoutMs;

    // Phase 1: wait until the model actually starts (turn appears or Stop shows up).
    const startDeadline = Date.now() + 60_000;
    for (;;) {
      if (this.aborted) return this.cancelled(Date.now() - t0);
      const isGen = dom.isGenerating();
      const currentAssistants = dom.getAssistantMessages().length;
      const currentTurns = dom.getConversationTurns().length;
      if (isGen || currentAssistants > assistantsBefore || currentTurns > turnsBefore) {
        break;
      }
      if (Date.now() > startDeadline) {
        throw new ContentError(
          ERR.SEND_FAILED,
          'Generation never started — open the ChatGPT tab to check for errors (rate limit, blocked prompt, model picker…)',
        );
      }
      await sleep(150);
    }

    // Phase 2: stream deltas until generation settles.
    let stablePolls = 0;
    let lastEmitAt = 0;
    let sawNewContent = false;

    for (;;) {
      if (this.aborted) {
        await actions.stopGenerating();
        try {
          await dom.waitForIdle(20_000);
        } catch {
          /* best effort */
        }
        return this.cancelled(Date.now() - t0);
      }

      const generating = dom.isGenerating();
      const assistantMessages = dom.getAssistantMessages();

      // On multi-turn: if a new assistant element exists, take the newest one
      // If count has not increased yet, check if the last assistant element has new text
      let el: HTMLElement | null = null;
      if (assistantMessages.length > assistantsBefore) {
        el = assistantMessages[assistantMessages.length - 1] ?? null;
      } else {
        const last = dom.getLastAssistant();
        if (last) {
          const currentText = extractMarkdown(last);
          if (currentText && currentText !== previousLastText) {
            el = last;
          }
        }
      }

      if (el) {
        const text = extractMarkdown(el);
        if (text && text !== this.lastText) {
          this.lastText = text;
          sawNewContent = true;
          stablePolls = 0;
          if (stream && Date.now() - lastEmitAt >= batchMs) {
            this.emitDelta(text);
            lastEmitAt = Date.now();
          }
        } else if (text && text === this.lastText) {
          stablePolls++;
        }
      } else if (sawNewContent) {
        stablePolls++;
      }

      // Generation is settled when:
      // 1. Model is no longer generating (stop button gone / send button returned)
      // 2. AND we got content and it's been stable for at least 2 polls (>= 500ms)
      //    OR if no new content was scraped yet but generation clearly finished and composer is back,
      //    check the last assistant fallback
      const hasComposerOrSend = dom.getComposer() != null || dom.getSendButton() != null;
      const settled = !generating && (
        (sawNewContent && stablePolls >= 2) ||
        (!sawNewContent && stablePolls >= 6 && hasComposerOrSend)
      );

      if (settled) {
        let text = this.lastText;
        if (!text) {
          const fallback = dom.getLastAssistant();
          if (fallback) {
            const fbText = extractMarkdown(fallback);
            if (fbText && fbText !== previousLastText) {
              text = fbText;
            }
          }
        }

        if (!text && dom.getConversationTurns().length <= turnsBefore) {
          throw new ContentError(ERR.SEND_FAILED, 'No response was produced');
        }

        if (stream && text && text !== this.lastEmitted) this.emitDelta(text);
        this.emitEvent('task.completed', { taskId: this.taskId, text, elapsedMs: Date.now() - t0 });
        return;
      }

      if (Date.now() > deadline) {
        await actions.stopGenerating();
        throw new ContentError(ERR.GENERATION_TIMEOUT, `Generation exceeded ${genTimeoutMs}ms — stopped the model`);
      }
      await sleep(250);
    }
  }

  private emitDelta(text: string): void {
    const delta = text.startsWith(this.lastEmitted) ? text.slice(this.lastEmitted.length) : text;
    this.lastEmitted = text;
    this.emitEvent('task.delta', { taskId: this.taskId, delta, text });
  }

  private fail(err: unknown): void {
    const shape =
      err instanceof ContentError
        ? err.toShape()
        : { code: (err as any)?.code ?? ERR.INTERNAL, message: String((err as any)?.message ?? err) };
    this.emitEvent('task.failed', { taskId: this.taskId, error: shape });
  }

  private cancelled(elapsedMs: number): void {
    this.emitEvent('task.cancelled', { taskId: this.taskId, text: this.lastText, elapsedMs });
  }
}

/** Method dispatcher living in the chatgpt.com page. */
export class PageAgent {
  private runner: TaskRunner | null = null;

  async handle(method: string, params: any): Promise<unknown> {
    switch (method) {
      case 'page.ping':
        return { ready: true, url: location.href, hasComposer: dom.getComposer() != null };
      case 'chatgpt.getSession':
        return this.getSession();
      case 'chatgpt.isBusy':
        return { busy: this.runner != null };
      case 'chatgpt.newChat':
        await actions.newChat();
        return { ok: true };
      case 'chatgpt.send':
        return this.send((params ?? {}) as SendParams);
      case 'chatgpt.cancel':
        return this.cancel(params?.taskId);
      case 'chatgpt.getLastResponse': {
        const el = dom.getLastAssistant();
        return { text: el ? extractMarkdown(el) : null, url: location.href };
      }
      case 'chatgpt.diagnostics':
        return this.diagnostics();
      default:
        throw new ContentError(ERR.UNKNOWN_METHOD, `Unknown content method: ${method}`);
    }
  }

  private async send(p: SendParams): Promise<{ taskId: string }> {
    if (this.runner) {
      if (!dom.isGenerating()) {
        console.warn('[PageAgent] Resetting idle/lingering runner before new send');
        this.runner.abort();
        this.runner = null;
      } else {
        throw new ContentError(ERR.TASK_BUSY, 'Another task is actively generating in this tab — cancel it or wait');
      }
    }
    const taskId = crypto.randomUUID();
    const runner = new TaskRunner(taskId, p, (event, payload) => this.emit(event, payload));
    this.runner = runner;
    void runner.finished.finally(() => {
      if (this.runner === runner) this.runner = null;
    });
    // Surface failures up to (and including) the send itself to the caller;
    // everything after resolves via task.* events.
    await Promise.race([runner.ready, runner.finished]);
    return { taskId };
  }

  private cancel(taskId?: string): Promise<{ ok: boolean }> {
    if (this.runner && (!taskId || this.runner.taskId === taskId)) {
      this.runner.abort();
      this.runner = null;
      return Promise.resolve({ ok: true });
    }
    return Promise.resolve({ ok: false });
  }

  private getSession() {
    const match = location.pathname.match(/\/c\/([0-9a-f-]{8,})/i);
    return {
      url: location.href,
      conversationId: match ? match[1] : null,
      loggedIn: dom.isLoggedIn(),
    };
  }

  private diagnostics(): any {
    const found: any = {};
    for (const [group, selectors] of Object.entries(dom.SELECTORS)) {
      found[group] = {};
      for (const sel of selectors as readonly string[]) {
        found[group][sel] = document.querySelectorAll(sel).length;
      }
    }

    // Inspect buttons in main form / footer / document
    const formButtons = Array.from(document.querySelectorAll('button')).slice(-15).map((b) => ({
      tagName: b.tagName,
      ariaLabel: b.getAttribute('aria-label'),
      dataTestId: b.getAttribute('data-testid'),
      type: b.getAttribute('type'),
      className: b.className.slice(0, 80),
      text: b.textContent?.trim().slice(0, 30),
      disabled: b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true',
    }));

    // Find all elements containing significant text in the document
    const textNodes: any[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const val = node.nodeValue?.trim();
      if (val && val.length > 20) {
        let parent = node.parentElement;
        const hierarchy: string[] = [];
        for (let i = 0; i < 4 && parent; i++) {
          const id = parent.id ? `#${parent.id}` : '';
          const cls = parent.className && typeof parent.className === 'string' ? `.${parent.className.split(' ').slice(0, 2).join('.')}` : '';
          const testId = parent.getAttribute('data-testid') ? `[data-testid="${parent.getAttribute('data-testid')}"]` : '';
          hierarchy.push(`${parent.tagName.toLowerCase()}${id}${testId}${cls}`);
          parent = parent.parentElement;
        }
        textNodes.push({
          snippet: val.slice(0, 60),
          hierarchy,
        });
        if (textNodes.length >= 10) break;
      }
    }

    // Inspect composer candidates
    const editables = Array.from(document.querySelectorAll('[contenteditable], textarea, [role="textbox"]')).map((el) => ({
      tagName: el.tagName,
      id: el.id,
      className: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
      ariaLabel: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      dataTestId: el.getAttribute('data-testid'),
    }));

    // Inspect Copy button ancestors and DilResponseRoot
    const copyBtn = document.querySelector('button[aria-label*="Copy"]');
    const copyAncestors: string[] = [];
    if (copyBtn) {
      let p: Element | null = copyBtn;
      for (let i = 0; i < 8 && p; i++) {
        const cls = p.className && typeof p.className === 'string' ? `.${p.className.split(' ').slice(0, 2).join('.')}` : '';
        const id = p.id ? `#${p.id}` : '';
        copyAncestors.push(`${p.tagName.toLowerCase()}${id}${cls} (textLen: ${p.textContent?.length ?? 0})`);
        p = p.parentElement;
      }
    }

    const dilRoots = Array.from(document.querySelectorAll('[class*="DilResponseRoot"], [class*="DilRenderer"], [class*="Renderer-"]')).slice(-3).map((el) => ({
      tagName: el.tagName,
      className: (el.className || '').slice(0, 80),
      textPreview: (el.textContent || '').trim().slice(0, 100),
      pCount: el.querySelectorAll('p').length,
    }));

    return {
      url: location.href,
      title: document.title,
      loggedIn: dom.isLoggedIn(),
      isGenerating: dom.isGenerating(),
      turnCount: dom.getConversationTurns().length,
      assistantCount: dom.getAssistantMessages().length,
      found,
      copyAncestors,
      dilRoots,
      editables,
      formButtons,
      textNodes,
    };
  }

  private emit(event: TaskEvent['event'], payload: Record<string, unknown>): void {
    void browser.runtime.sendMessage({ [EVENT_TAG]: true, event, payload }).catch(() => {
      /* background asleep or restarting — events are best-effort */
    });
  }
}
