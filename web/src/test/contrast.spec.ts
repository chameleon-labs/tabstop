// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {contrastBetween} from './contrast';

/**
 * A resolver reading one theme twice, or stopping at the first `var()` hop,
 * would make every contrast assertion vacuous while passing.
 */
describe('contrastBetween', () => {
  it('measures a known-good pairing', () => {
    expect(contrastBetween('--lat-text', '--lat-bg-raised', 'dark')).toBeCloseTo(14.53, 1);
    expect(contrastBetween('--lat-text', '--lat-bg-raised', 'light')).toBeCloseTo(19.47, 1);
  });

  it('measures the known-bad pairing this was written for', () => {
    // Above 4.5 here means the helper broke, not Lattice.
    expect(contrastBetween('--lat-text-subtle', '--lat-bg-raised', 'dark')).toBeCloseTo(3.67, 1);
  });

  it('answers differently per theme, rather than reading one block twice', () => {
    const light = contrastBetween('--lat-text-subtle', '--lat-bg-raised', 'light');
    const dark = contrastBetween('--lat-text-subtle', '--lat-bg-raised', 'dark');

    expect(light).not.toBeCloseTo(dark, 1);
  });

  it('follows the alias chain rather than stopping at the first var()', () => {
    // One hop returns a `var(...)` string, which is not a colour.
    expect(contrastBetween('--lat-text', '--lat-bg-raised', 'dark')).toBeCloseTo(
      contrastBetween('--lat-gray-text', '--lat-bg-raised', 'dark'),
      5,
    );
  });

  it('reports 1 for a colour against itself', () => {
    expect(contrastBetween('--lat-text', '--lat-text', 'dark')).toBeCloseTo(1, 5);
  });

  it('refuses a token that resolves to nothing, rather than reporting a number', () => {
    expect(() => contrastBetween('--lat-not-a-token', '--lat-bg-raised', 'dark')).toThrow(/resolves to nothing/);
  });
});
