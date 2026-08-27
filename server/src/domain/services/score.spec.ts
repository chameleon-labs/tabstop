import {randomUUID} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {summariseViolations, type ScoredViolation} from './score.js';
import type {Impact} from '../models/impact.js';

const rule = (impact: Impact | null, nodeCount: number, ruleId: string = randomUUID()): ScoredViolation => ({
  ruleId,
  impact,
  nodeCount,
});

describe('summariseViolations', () => {
  describe('the score', () => {
    const cases: {name: string; violations: ScoredViolation[]; score: number}[] = [
      {name: 'a clean page', violations: [], score: 100},
      {name: 'one critical rule, one element', violations: [rule('critical', 1)], score: 90},
      {name: 'one serious rule, two elements', violations: [rule('serious', 2)], score: 90},
      {name: 'one moderate rule, two elements', violations: [rule('moderate', 2)], score: 96},
      {name: 'one minor rule, three elements', violations: [rule('minor', 3)], score: 97},
      {
        name: 'one critical rule, 200 elements',
        violations: [rule('critical', 200)],
        score: 50,
      },
      {
        name: 'mixed impacts',
        violations: [rule('critical', 1), rule('serious', 2), rule('minor', 3)],
        score: 77,
      },
      {
        name: 'deductions past 100',
        violations: [rule('critical', 5), rule('critical', 5), rule('critical', 5)],
        score: 0,
      },
      {name: 'one unknown-severity rule, one element', violations: [rule(null, 1)], score: 99},
      {
        name: 'one unknown-severity rule, 200 elements',
        violations: [rule(null, 200)],
        score: 95,
      },
    ];

    it.each(cases)('scores $name as $score', ({violations, score}) => {
      expect(summariseViolations(violations).score).toBe(score);
    });

    it('never returns a negative score', () => {
      const violations = Array.from({length: 50}, () => rule('critical', 5));

      expect(summariseViolations(violations).score).toBe(0);
    });

    it('always returns an integer between 0 and 100', () => {
      const inputs: ScoredViolation[][] = [
        [],
        [rule('minor', 1)],
        [rule(null, 7)],
        [rule('critical', 200)],
        Array.from({length: 20}, () => rule('serious', 3)),
      ];

      for (const violations of inputs) {
        const {score} = summariseViolations(violations);
        expect(Number.isInteger(score)).toBe(true);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('merging duplicated rules', () => {
    it('caps a repeated rule once rather than once per entry', () => {
      const violations = [rule('critical', 3, 'image-alt'), rule('critical', 4, 'image-alt')];

      expect(summariseViolations(violations).score).toBe(50);
    });

    it('deducts a conflicted rule at its most severe impact', () => {
      const violations = [rule('moderate', 1, 'color-contrast'), rule('serious', 1, 'color-contrast')];

      const summary = summariseViolations(violations);
      expect(summary.score).toBe(90);
      expect(summary.countsByImpact).toEqual({minor: 0, moderate: 0, serious: 2, critical: 0});
    });

    it('picks the most severe impact regardless of the order seen', () => {
      const ascending = [rule('moderate', 1, 'color-contrast'), rule('serious', 1, 'color-contrast')];
      const descending = [rule('serious', 1, 'color-contrast'), rule('moderate', 1, 'color-contrast')];

      expect(summariseViolations(ascending).score).toBe(90);
      expect(summariseViolations(descending)).toEqual(summariseViolations(ascending));
    });

    it('lets a known impact win over an unknown one', () => {
      const violations = [rule(null, 1, 'label'), rule('minor', 1, 'label')];

      expect(summariseViolations(violations).countsByImpact.minor).toBe(2);
    });

    it('counts a repeated rule once, with its elements summed', () => {
      const violations = [rule('serious', 3, 'color-contrast'), rule('serious', 4, 'color-contrast')];

      const summary = summariseViolations(violations);
      expect(summary.countsByImpact.serious).toBe(7);
      expect(summary.score).toBe(75);
    });
  });

  describe('the counts', () => {
    it('spells out all four keys for a clean page', () => {
      expect(summariseViolations([]).countsByImpact).toEqual({minor: 0, moderate: 0, serious: 0, critical: 0});
    });

    it('counts every element, uncapped, while the score is capped', () => {
      const summary = summariseViolations([rule('critical', 200)]);

      expect(summary.countsByImpact.critical).toBe(200);
      expect(summary.score).toBe(50);
    });

    it('counts per element rather than per rule', () => {
      const violations = [rule('critical', 2, 'image-alt'), rule('serious', 1, 'color-contrast')];

      expect(summariseViolations(violations).countsByImpact).toEqual({minor: 0, moderate: 0, serious: 1, critical: 2});
    });

    it('leaves unknown severity out of every bucket', () => {
      const summary = summariseViolations([rule(null, 3)]);

      expect(summary.countsByImpact).toEqual({minor: 0, moderate: 0, serious: 0, critical: 0});
      expect(summary.score).toBe(97);
    });
  });
});
