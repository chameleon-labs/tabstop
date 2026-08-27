// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, it} from 'vitest';
import {THEME_STORAGE_KEY} from './theme';

const html = readFileSync('index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');

const bootScript = (): string => {
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (match?.[1] === undefined) {
    throw new Error('index.html has no inline <script>; the theme boot script is missing');
  }
  return match[1];
};

const runBoot = (): void => {
  // eslint-disable-next-line no-new-func
  new Function(bootScript())();
};

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-lat-theme');
  document.documentElement.style.removeProperty('color-scheme');
});

describe('the theme boot script', () => {
  it('runs before the body, so nothing paints under the wrong theme', () => {
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<body>'));
  });

  it('is render-blocking: no defer, no async, no module', () => {
    const tag = /<script[^>]*>/.exec(html)?.[0] ?? '';

    expect(tag).toBe('<script>');
  });

  it('reads the key the app writes', () => {
    expect(bootScript()).toContain(THEME_STORAGE_KEY);
  });

  it('stamps a stored dark choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    runBoot();

    expect(document.documentElement).toHaveAttribute('data-lat-theme', 'dark');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('dark');
  });

  it('stamps a stored light choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');

    runBoot();

    expect(document.documentElement).toHaveAttribute('data-lat-theme', 'light');
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
  });

  it('stamps nothing when no choice is stored, leaving the media query in charge', () => {
    runBoot();

    expect(document.documentElement.hasAttribute('data-lat-theme')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('');
  });

  it('stamps nothing for a value it does not recognise', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'solarized');

    runBoot();

    expect(document.documentElement.hasAttribute('data-lat-theme')).toBe(false);
  });

  it('does not throw when storage is unavailable', () => {
    const {getItem} = Storage.prototype;
    Storage.prototype.getItem = (): never => {
      throw new DOMException('SecurityError');
    };

    try {
      expect(() => {
        runBoot();
      }).not.toThrow();
    } finally {
      Storage.prototype.getItem = getItem;
    }
  });
});
