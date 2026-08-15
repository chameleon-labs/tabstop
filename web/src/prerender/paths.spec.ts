import {describe, expect, it} from 'vitest';
import {outputFor, PRERENDER_PATHS} from './paths';

describe('prerender paths', () => {
  it('includes every public compile-time page and maps each to its host output', () => {
    expect(PRERENDER_PATHS).toEqual(['/', '/docs/score-formula']);
    expect(outputFor('/build/dist', '/')).toBe('/build/dist/index.html');
    expect(outputFor('/build/dist', '/docs/score-formula')).toBe('/build/dist/docs/score-formula/index.html');
  });
});
