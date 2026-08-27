import {describe, expect, it} from 'vitest';
import {servesAppShell, outputFor, PRERENDER_PAGES, PRERENDER_PATHS} from './paths';

describe('prerender paths', () => {
  it('includes every public compile-time page and maps each to its host output', () => {
    expect(PRERENDER_PATHS).toEqual(['/', '/docs/score-formula']);
    expect(outputFor('/build/dist', '/')).toBe('/build/dist/index.html');
    expect(outputFor('/build/dist', '/docs/score-formula')).toBe('/build/dist/docs/score-formula/index.html');
  });

  it('gives every page but the landing its own head metadata and route chunk', () => {
    const landing = PRERENDER_PAGES.find(({path}) => path === '/');
    const formula = PRERENDER_PAGES.find(({path}) => path === '/docs/score-formula');

    expect(landing?.title).toBeUndefined();
    expect(landing?.entry).toBeUndefined();

    expect(formula?.title).toBe('Score formula · tabstop');
    expect(formula?.description).toMatch(/formula/i);
    expect(formula?.entry).toBe('src/screens/modules/docs/pages/ScoreFormula/index.tsx');
  });
});

describe('servesAppShell', () => {
  it.each(['/dashboard', '/pages/42', '/login', '/signup', '/r/abc', '/anything'])(
    'answers %s from the shell',
    (path) => {
      expect(servesAppShell(path)).toBe(true);
    },
  );

  it.each(['/', '/docs/score-formula', '/docs/score-formula/'])('leaves %s to its prerendered file', (path) => {
    expect(servesAppShell(path)).toBe(false);
  });

  it('ignores a query string, which a host does not route on', () => {
    expect(servesAppShell('/?utm=x')).toBe(false);
    expect(servesAppShell('/dashboard?from=/x')).toBe(true);
  });
});
