import '@/globals.css';
import { createRoot } from 'react-dom/client';
import { applySavedTheme } from '@/lib/theme';
import App from './App';

void applySavedTheme().finally(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});
