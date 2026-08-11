/** `system` is the absence of a stamp: Lattice then follows the media query. */
export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

/** Read by the inline boot script in `index.html`, which cannot import this. */
export const THEME_STORAGE_KEY = 'tabstop:theme';

export const isTheme = (value: unknown): value is Theme => THEMES.includes(value as Theme);

/** Storage is user-writable, so an unrecognised value falls back. */
export const readStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
};

/** Absence means "follow the system" - one spelling, for the boot script. */
export const storeTheme = (theme: Theme): void => {
  try {
    if (theme === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY);
      return;
    }
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Safari private mode throws; a theme is not worth a broken page.
  }
};

/**
 * `color-scheme` moves with the attribute, or light-on-dark-OS keeps dark
 * scrollbars.
 */
export const applyTheme = (theme: Theme, root: HTMLElement = document.documentElement): void => {
  if (theme === 'system') {
    root.removeAttribute('data-lat-theme');
    root.style.removeProperty('color-scheme');
    return;
  }

  root.setAttribute('data-lat-theme', theme);
  root.style.setProperty('color-scheme', theme);
};
