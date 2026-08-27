import {describe, expect, it} from 'vitest';
import {IMPACTS, type Impact} from './impact.js';

describe('IMPACTS', () => {
  it('lists every impact exactly once', () => {
    expect([...IMPACTS].toSorted()).toEqual(['critical', 'minor', 'moderate', 'serious']);
  });

  it('is exhaustive over the Impact union', () => {
    const seen: Record<Impact, boolean> = {
      minor: false,
      moderate: false,
      serious: false,
      critical: false,
    };
    for (const impact of IMPACTS) {
      seen[impact] = true;
    }

    expect(Object.values(seen).every(Boolean)).toBe(true);
  });
});
