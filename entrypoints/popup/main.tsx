import '@/globals.css';
import { createRoot } from 'react-dom/client';
import { applySavedTheme } from '@/lib/theme';
import App from './App';

const embedded = new URLSearchParams(location.search).get('panel') === '1';
if (embedded) document.documentElement.dataset.surface = 'panel';

function closePanel() {
  window.parent.postMessage({ type: 'chatgpt-bridge:close' }, '*');
}

void applySavedTheme().finally(() => {
  const root = document.getElementById('root')!;
  createRoot(root).render(<App embedded={embedded} onClose={embedded ? closePanel : undefined} />);
  if (embedded) {
    const observer = new ResizeObserver(() => {
      const shell = root.firstElementChild;
      if (!shell) return;
      window.parent.postMessage({
        type: 'chatgpt-bridge:resize',
        height: shell.getBoundingClientRect().height,
        radius: parseFloat(getComputedStyle(shell).borderTopLeftRadius),
      }, '*');
    });
    observer.observe(root);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePanel();
      }
    });
  }
});
