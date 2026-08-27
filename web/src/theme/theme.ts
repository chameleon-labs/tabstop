export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'tabstop:theme';

export const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);

export const readStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

export const storeTheme = (theme: Theme): void => {
  try {
    if (theme === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
      return;
    }
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {}
};

export const applyTheme = (theme: Theme, root: HTMLElement = document.documentElement): void => {
  if (theme === 'system') {
    root.removeAttribute('data-lat-theme');
    root.style.removeProperty('color-scheme');
    return;
  }

  root.setAttribute('data-lat-theme', theme);
  root.style.setProperty('color-scheme', theme);
};
