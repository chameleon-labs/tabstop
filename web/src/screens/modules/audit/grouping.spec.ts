import type {Violation} from '@tabstop/contract';
import {describe, expect, it} from 'vitest';
import {EXPAND_ALL_BELOW, bySeverity, startsExpanded} from './grouping';

describe('startsExpanded', () => {
  it('opens a short list, so two problems are readable without clicking', () => {
    expect(startsExpanded(1)).toBe(true);
    expect(startsExpanded(EXPAND_ALL_BELOW - 1)).toBe(true);
  });

  it('collapses a long one, because forty findings is a wall rather than a list', () => {
    expect(startsExpanded(EXPAND_ALL_BELOW)).toBe(false);
    expect(startsExpanded(40)).toBe(false);
  });
});

describe('bySeverity', () => {
  const at = (impact: Violation['impact'], ruleId: string): Violation => ({
    ruleId,
    impact,
    description: ruleId,
    helpUrl: 'https://example.test',
    nodes: [],
  });

  it('puts the most severe first, and the unrated last', () => {
    const sorted = bySeverity([at(null, 'e'), at('minor', 'd'), at('critical', 'a'), at('serious', 'b')]);

    expect(sorted.map((found) => found.ruleId)).toEqual(['a', 'b', 'd', 'e']);
  });

  it('keeps the order the server sent within one severity', () => {
    const sorted = bySeverity([at('serious', 'first'), at('serious', 'second'), at('serious', 'third')]);

    expect(sorted.map((found) => found.ruleId)).toEqual(['first', 'second', 'third']);
  });

  it('leaves the response alone', () => {
    const original = [at('minor', 'b'), at('critical', 'a')];

    bySeverity(original);

    expect(original.map((found) => found.ruleId)).toEqual(['b', 'a']);
  });
});
