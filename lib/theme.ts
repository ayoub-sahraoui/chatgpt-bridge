import { getSettings } from './settings';

export type ThemePref = 'dark' | 'light' | 'system';

export function applyThemeValue(theme: ThemePref): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
}

/** Load the saved theme and apply it (call before React renders to avoid flashes). */
export async function applySavedTheme(): Promise<void> {
  applyThemeValue((await getSettings()).theme);
}
