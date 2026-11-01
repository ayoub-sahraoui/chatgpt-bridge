// This function is serialized by scripting.executeScript; keep it self-contained.
export async function togglePagePanel(panelUrl: string, panelOrigin: string): Promise<boolean> {
  const scope = globalThis as typeof globalThis & { __chatgptBridgePanelClose?: () => void };
  if (scope.__chatgptBridgePanelClose) {
    scope.__chatgptBridgePanelClose();
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const previousFocus = document.activeElement;
    const controller = new AbortController();
    const host = document.createElement('chatgpt-bridge-panel');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .panel {
        position: fixed; inset: 4px 4px auto auto; margin: 0; padding: 0;
        width: min(360px, calc(100vw - 8px)); height: 560px;
        max-height: calc(100dvh - 8px); border: 0; border-radius: 18px;
        overflow: hidden; background: transparent; color-scheme: normal;
        box-shadow: 0 16px 48px rgb(0 0 0 / 0.18), 0 2px 8px rgb(0 0 0 / 0.1);
      }
      iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
    `;
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'ChatGPT Bridge');
    panel.popover = 'auto';
    const iframe = document.createElement('iframe');
    iframe.title = 'ChatGPT Bridge';
    iframe.src = panelUrl;
    iframe.allow = `clipboard-write ${panelOrigin}`;
    panel.append(iframe);
    shadow.append(style, panel);

    let closed = false;
    const timer = setTimeout(() => close(false), 5000);
    function close(shown = true) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      controller.abort();
      if (panel.matches(':popover-open')) panel.hidePopover();
      host.remove();
      delete scope.__chatgptBridgePanelClose;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      resolve(shown);
    }
    scope.__chatgptBridgePanelClose = close;

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || event.origin !== panelOrigin) return;
      const data: unknown = event.data;
      if (!data || typeof data !== 'object') return;
      const message = data as { type?: string; height?: number; radius?: number };
      if (message.type === 'chatgpt-bridge:close') close();
      if (message.type === 'chatgpt-bridge:resize' && typeof message.height === 'number' && Number.isFinite(message.height) && message.height > 0 && message.height < 2000) {
        panel.style.height = `${Math.ceil(message.height)}px`;
        if (typeof message.radius === 'number' && Number.isFinite(message.radius) && message.radius >= 0 && message.radius <= 64) {
          panel.style.borderRadius = `${message.radius}px`;
        }
        clearTimeout(timer);
        resolve(true);
      }
    }, { signal: controller.signal });
    panel.addEventListener('toggle', () => {
      if (!panel.matches(':popover-open')) close();
    }, { signal: controller.signal });

    document.documentElement.append(host);
    try {
      panel.showPopover();
      iframe.focus();
    } catch {
      close(false);
    }
  });
}
