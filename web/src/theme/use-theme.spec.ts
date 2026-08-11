// @vitest-environment jsdom
import {act, renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';
import {THEME_STORAGE_KEY} from './theme';
import {useTheme} from './use-theme';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-lat-theme');
  document.documentElement.style.removeProperty('color-scheme');
});

describe('useTheme', () => {
  it('starts from what was stored', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    const {result} = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
  });

  it('starts at system when nothing was stored', () => {
    const {result} = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');
  });

  it('leaves the document alone on mount, because the boot script already stamped it', () => {
    // Re-applying would hide a broken boot script.
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    renderHook(() => useTheme());

    expect(document.documentElement.hasAttribute('data-lat-theme')).toBe(false);
  });

  it('persists and stamps a choice, in that order of consequence', () => {
    const {result} = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('light');
    });

    expect(result.current.theme).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement).toHaveAttribute('data-lat-theme', 'light');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('unstamps when the reader hands the choice back to their system', () => {
    const {result} = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme('dark');
    });
    act(() => {
      result.current.setTheme('system');
    });

    expect(result.current.theme).toBe('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute('data-lat-theme')).toBe(false);
  });

  it('keeps one setTheme identity, so a menu item does not remount on every change', () => {
    const {result} = renderHook(() => useTheme());
    const first = result.current.setTheme;

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.setTheme).toBe(first);
  });
});
