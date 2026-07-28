import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { summariseViolations, type ScoredViolation } from './score.js'
import type { Impact } from '../models/impact.js'

/**
 * Rule ids default to a fresh uuid. That matters: the function merges by
 * ruleId, so a shared default would silently collapse cases that are meant to
 * be separate rules - and the resulting scores would still look plausible.
 */
const rule = (
  impact: Impact | null,
  nodeCount: number,
  ruleId: string = randomUUID()
): ScoredViolation => ({ ruleId, impact, nodeCount })

describe('summariseViolations', () => {
  describe('the score', () => {
    const cases: Array<{ name: string, violations: ScoredViolation[], score: number }> = [
      { name: 'a clean page', violations: [], score: 100 },
      { name: 'one critical rule, one element', violations: [rule('critical', 1)], score: 90 },
      { name: 'one serious rule, two elements', violations: [rule('serious', 2)], score: 90 },
      { name: 'one moderate rule, two elements', violations: [rule('moderate', 2)], score: 96 },
      { name: 'one minor rule, three elements', violations: [rule('minor', 3)], score: 97 },
      {
        // The cap: 10 x min(200, 5) = 50, not 10 x 200. One unlabelled icon
        // repeated across a page must not zero an otherwise fine site.
        name: 'one critical rule, 200 elements',
        violations: [rule('critical', 200)],
        score: 50
      },
      {
        // 10 + (5 x 2) + (1 x 3) = 23
        name: 'mixed impacts',
        violations: [rule('critical', 1), rule('serious', 2), rule('minor', 3)],
        score: 77
      },
      {
        // 3 capped critical rules deduct 150. The floor holds at 0.
        name: 'deductions past 100',
        violations: [rule('critical', 5), rule('critical', 5), rule('critical', 5)],
        score: 0
      },
      { name: 'one unknown-severity rule, one element', violations: [rule(null, 1)], score: 99 },
      {
        // The cap applies to unknown severity too.
        name: 'one unknown-severity rule, 200 elements',
        violations: [rule(null, 200)],
        score: 95
      }
    ]

    it.each(cases)('scores $name as $score', ({ violations, score }) => {
      expect(summariseViolations(violations).score).toBe(score)
    })

    it('never returns a negative score', () => {
      const violations = Array.from({ length: 50 }, () => rule('critical', 5))

      expect(summariseViolations(violations).score).toBe(0)
    })

    it('always returns an integer between 0 and 100', () => {
      // The column is a smallint with `check (score between 0 and 100)`, so a
      // fractional or out-of-range score fails at completion time - a long way
      // from whatever produced it.
      const inputs: ScoredViolation[][] = [
        [],
        [rule('minor', 1)],
        [rule(null, 7)],
        [rule('critical', 200)],
        Array.from({ length: 20 }, () => rule('serious', 3))
      ]

      for (const violations of inputs) {
        const { score } = summariseViolations(violations)
        expect(Number.isInteger(score)).toBe(true)
        expect(score).toBeGreaterThanOrEqual(0)
        expect(score).toBeLessThanOrEqual(100)
      }
    })
  })

  describe('merging duplicated rules', () => {
    it('caps a repeated rule once rather than once per entry', () => {
      // Unmerged this deducts (10 x 3) + (10 x 4) = 70 and scores 30. Merged,
      // the rule has 7 elements, the cap takes it to 5, and it deducts 50.
      const violations = [rule('critical', 3, 'image-alt'), rule('critical', 4, 'image-alt')]

      expect(summariseViolations(violations).score).toBe(50)
    })

    it('deducts a conflicted rule at its most severe impact', () => {
      // Unmerged: (2 x 1) + (5 x 1) = 7, scoring 93. Merged at serious with
      // two elements: 5 x 2 = 10.
      const violations = [rule('moderate', 1, 'color-contrast'), rule('serious', 1, 'color-contrast')]

      expect(summariseViolations(violations).score).toBe(90)
    })

    it('picks the most severe impact regardless of the order seen', () => {
      const ascending = [rule('moderate', 1, 'color-contrast'), rule('serious', 1, 'color-contrast')]
      const descending = [rule('serious', 1, 'color-contrast'), rule('moderate', 1, 'color-contrast')]

      // Pinned to a value, not just to each other: two identically wrong
      // results would satisfy an equality check on its own.
      expect(summariseViolations(ascending).score).toBe(90)
      expect(summariseViolations(descending)).toEqual(summariseViolations(ascending))
    })

    it('lets a known impact win over an unknown one', () => {
      // Unknown severity deducts at the same weight as minor, but it must not
      // displace a classification we actually have - the counts depend on it.
      const violations = [rule(null, 1, 'label'), rule('minor', 1, 'label')]

      expect(summariseViolations(violations).countsByImpact.minor).toBe(2)
    })

    it('counts a repeated rule once, with its elements summed', () => {
      const violations = [rule('serious', 3, 'color-contrast'), rule('serious', 4, 'color-contrast')]

      expect(summariseViolations(violations).countsByImpact.serious).toBe(7)
    })
  })

  describe('the counts', () => {
    it('spells out all four keys for a clean page', () => {
      // The check constraint on counts_by_impact rejects a partial record.
      expect(summariseViolations([]).countsByImpact)
        .toEqual({ minor: 0, moderate: 0, serious: 0, critical: 0 })
    })

    it('counts every element, uncapped, while the score is capped', () => {
      // The cap is a scoring device. The counts are what stop the number from
      // hiding the size of the problem.
      const summary = summariseViolations([rule('critical', 200)])

      expect(summary.countsByImpact.critical).toBe(200)
      expect(summary.score).toBe(50)
    })

    it('counts per element rather than per rule', () => {
      const violations = [rule('critical', 2, 'image-alt'), rule('serious', 1, 'color-contrast')]

      expect(summariseViolations(violations).countsByImpact)
        .toEqual({ minor: 0, moderate: 0, serious: 1, critical: 2 })
    })

    it('leaves unknown severity out of every bucket', () => {
      // There are exactly four buckets and no home for an unclassified
      // violation. It still deducts, and it is still in the violation list.
      const summary = summariseViolations([rule(null, 3)])

      expect(summary.countsByImpact).toEqual({ minor: 0, moderate: 0, serious: 0, critical: 0 })
      expect(summary.score).toBe(97)
    })
  })
})
