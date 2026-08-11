// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {THEME_STORAGE_KEY, applyTheme, isTheme, readStoredTheme, storeTheme, type Theme} from './theme';

const root = (): HTMLElement => document.documentElement;

afterEach(() => {
  localStorage.clear();
  root().removeAttribute('data-lat-theme');
  root().style.removeProperty('color-scheme');
});

describe('isTheme', () => {
  it('accepts the three the app supports', () => {
    expect(isTheme('system')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
  });

  it('rejects anything else, because storage is user-writable', () => {
    // Editable from devtools, so untrusted input like any other.
    expect(isTheme('DARK')).toBe(false);
    expect(isTheme('')).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(0)).toBe(false);
  });
});

describe('readStoredTheme', () => {
  it('falls back to following the system when nothing is stored', () => {
    expect(readStoredTheme()).toBe('system');
  });

  it('returns what was stored', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');

    expect(readStoredTheme()).toBe('light');
  });

  it('falls back rather than trusting a value it does not recognise', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'solarized');

    expect(readStoredTheme()).toBe('system');
  });
});

describe('applyTheme', () => {
  it('stamps an explicit choice on the document element', () => {
    applyTheme('dark');

    expect(root()).toHaveAttribute('data-lat-theme', 'dark');
  });

  it('removes the stamp for system, so the tokens fall back to the media query', () => {
    // An attribute of "system" matches neither branch and pins light forever.
    applyTheme('dark');

    applyTheme('system');

    expect(root().hasAttribute('data-lat-theme')).toBe(false);
  });

  it('moves color-scheme with the choice, so native controls follow', () => {
    // Light on a dark OS would otherwise keep dark scrollbars.
    applyTheme('light');

    expect(root().style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('hands color-scheme back to the stylesheet for system', () => {
    applyTheme('light');

    applyTheme('system');

    expect(root().style.getPropertyValue('color-scheme')).toBe('');
  });
});

describe('storeTheme', () => {
  it('persists an explicit choice', () => {
    storeTheme('dark');

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('clears the key for system rather than writing "system"', () => {
    // Absence is what the inline boot script tests for; one spelling only.
    storeTheme('dark');

    storeTheme('system');

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('survives storage being unavailable', () => {
    // Safari private mode throws from setItem.
    const {setItem} = Storage.prototype;
    Storage.prototype.setItem = (): never => {
      throw new DOMException('QuotaExceededError');
    };

    try {
      expect(() => {
        storeTheme('dark');
      }).not.toThrow();
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});

describe('the round trip', () => {
  it.each<Theme>(['system', 'light', 'dark'])('restores %s across a reload', (theme) => {
    storeTheme(theme);

    const restored = readStoredTheme();
    applyTheme(restored);

    expect(restored).toBe(theme);
  });
});
