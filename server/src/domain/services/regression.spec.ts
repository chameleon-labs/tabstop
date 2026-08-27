import {describe, expect, it} from 'vitest';
import {detectRegression, diffViolations, type AuditSnapshot, type ViolationSnapshot} from './regression.js';

const violation = (ruleId: string, impact: ViolationSnapshot['impact']): ViolationSnapshot => ({ruleId, impact});

const snapshot = (overrides: Partial<AuditSnapshot> = {}): AuditSnapshot => ({
  score: 90,
  axeVersion: '4.12.1',
  violations: [],
  ...overrides,
});

describe('diffViolations', () => {
  it('classifies rules as added, fixed or unchanged by rule id', () => {
    const previous = [
      {...violation('kept', 'minor'), source: 'previous-kept'},
      {...violation('fixed', 'critical'), source: 'previous-fixed'},
    ];
    const current = [
      {...violation('kept', 'serious'), source: 'current-kept'},
      {...violation('added', 'moderate'), source: 'current-added'},
    ];

    expect(diffViolations(current, previous)).toEqual({
      added: [current[1]],
      fixed: [previous[1]],
      unchanged: [current[0]],
    });
  });
});

describe('detectRegression', () => {
  const cases: {
    name: string;
    current: AuditSnapshot;
    previous: AuditSnapshot | null;
    threshold: number;
    expected: ReturnType<typeof detectRegression>;
  }[] = [
    {
      name: 'the first audit',
      current: snapshot({score: 10, violations: [violation('image-alt', 'critical')]}),
      previous: null,
      threshold: 5,
      expected: {kind: 'none'},
    },
    {
      name: 'a score drop below the threshold',
      current: snapshot({score: 86}),
      previous: snapshot({score: 90}),
      threshold: 5,
      expected: {kind: 'none'},
    },
    {
      name: 'a score drop exactly at the threshold',
      current: snapshot({score: 85}),
      previous: snapshot({score: 90}),
      threshold: 5,
      expected: {kind: 'score_drop', delta: 5},
    },
    {
      name: 'a new serious rule with a flat score',
      current: snapshot({
        violations: [violation('existing', 'minor'), violation('focus-order-semantics', 'serious')],
      }),
      previous: snapshot({violations: [violation('existing', 'minor')]}),
      threshold: 5,
      expected: {kind: 'new_critical', ruleIds: ['focus-order-semantics']},
    },
    {
      name: 'a new critical rule with a flat score',
      current: snapshot({violations: [violation('image-alt', 'critical')]}),
      previous: snapshot(),
      threshold: 5,
      expected: {kind: 'new_critical', ruleIds: ['image-alt']},
    },
    {
      name: 'a new moderate rule with a flat score',
      current: snapshot({violations: [violation('landmark-unique', 'moderate')]}),
      previous: snapshot(),
      threshold: 5,
      expected: {kind: 'none'},
    },
    {
      name: 'an existing rule that became serious',
      current: snapshot({violations: [violation('label', 'serious')]}),
      previous: snapshot({violations: [violation('label', 'minor')]}),
      threshold: 5,
      expected: {kind: 'none'},
    },
    {
      name: 'a simultaneous score drop and new severe rule',
      current: snapshot({
        score: 70,
        violations: [violation('label', 'serious'), violation('image-alt', 'critical')],
      }),
      previous: snapshot({score: 90, violations: [violation('label', 'serious')]}),
      threshold: 5,
      expected: {kind: 'new_critical', ruleIds: ['image-alt']},
    },
    {
      name: 'an axe engine version change',
      current: snapshot({
        score: 50,
        axeVersion: '4.13.0',
        violations: [violation('new-rule', 'critical')],
      }),
      previous: snapshot({score: 90, axeVersion: '4.12.1'}),
      threshold: 5,
      expected: {kind: 'none'},
    },
  ];

  it.each(cases)('classifies $name', ({current, previous, threshold, expected}) => {
    expect(detectRegression(current, previous, threshold)).toEqual(expected);
  });
});
