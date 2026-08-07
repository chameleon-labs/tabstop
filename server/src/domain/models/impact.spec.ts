import {describe, expect, it} from 'vitest';
import {IMPACTS, type Impact} from './impact.js';

describe('IMPACTS', () => {
  it('lists every impact exactly once', () => {
    expect([...IMPACTS].toSorted()).toEqual(['critical', 'minor', 'moderate', 'serious']);
  });

  it('is exhaustive over the Impact union', () => {
    // This is a compile-time guard as much as a runtime one: if a member is
    // added to Impact without being added to IMPACTS, the Record literal below
    // stops compiling, and the loop below stops setting every key to true.
    const seen: Record<Impact, boolean> = {
      minor: false,
      moderate: false,
      serious: false,
      critical: false,
    };
    for (const impact of IMPACTS) seen[impact] = true;

    expect(Object.values(seen).every(Boolean)).toBe(true);
  });
});
