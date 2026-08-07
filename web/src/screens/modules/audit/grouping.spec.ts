import type {Impact, Violation} from '@tabstop/contract';
import {describe, expect, it} from 'vitest';
import {EXPAND_ALL_BELOW, IMPACT_ORDER, groupByImpact, startsExpanded} from './grouping';

const violation = (impact: Impact | null, ruleId = 'rule'): Violation => ({
  ruleId,
  impact,
  description: 'A description',
  helpUrl: 'https://example.test',
  nodes: [],
});

describe('groupByImpact', () => {
  it('orders groups most severe first, which is also fix order', () => {
    const groups = groupByImpact([
      violation('minor'),
      violation('critical'),
      violation('moderate'),
      violation('serious'),
    ]);

    expect(groups.map((group) => group.impact)).toEqual(['critical', 'serious', 'moderate', 'minor']);
  });

  it('keeps unrated findings, and puts them last', () => {
    // axe reports violations with no severity and the contract keeps `impact`
    // nullable for exactly that reason. Dropping them hides real findings; the
    // whole product is about not hiding findings.
    const groups = groupByImpact([violation(null), violation('critical')]);

    expect(groups.map((group) => group.impact)).toEqual(['critical', null]);
    expect(groups.at(-1)?.violations).toHaveLength(1);
  });

  it('names the unrated group rather than leaving it blank', () => {
    // "Unknown severity" is information. An unlabelled group reads like a bug.
    expect(groupByImpact([violation(null)])[0]?.label).toBe('Unrated');
  });

  it('does not sort unrated alongside minor', () => {
    // They are not the same claim. Unknown severity is unknown, not low.
    const groups = groupByImpact([violation(null), violation('minor')]);

    expect(groups).toHaveLength(2);
  });

  it('omits groups with nothing in them', () => {
    // "Critical (0)" is noise on a clean page and reads as a finding at a
    // glance. The counts beside the score already say what is absent.
    const groups = groupByImpact([violation('minor')]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.impact).toBe('minor');
  });

  it('is empty for a page with no violations', () => {
    expect(groupByImpact([])).toEqual([]);
  });

  it('keeps every violation exactly once', () => {
    // The property that matters most: grouping must not lose or duplicate a
    // finding. Asserted on the count rather than on the arrangement, so it
    // survives any future reordering.
    const violations = [
      violation('critical', 'a'),
      violation('critical', 'b'),
      violation(null, 'c'),
      violation('minor', 'd'),
      violation('serious', 'e'),
    ];

    const grouped = groupByImpact(violations).flatMap((group) => group.violations);

    expect(grouped).toHaveLength(violations.length);
    expect(new Set(grouped.map((v) => v.ruleId)).size).toBe(violations.length);
  });

  it('orders exactly the impacts the contract defines, plus unrated', () => {
    // Written as a LITERAL rather than derived from `IMPACT_ORDER`. The version
    // this replaces built its fixture by mapping that same array, so both sides
    // of the assertion moved together: a fifth contract impact would have left
    // them equal while every finding carrying it was dropped.
    //
    // The exhaustiveness half is `AllImpactsOrdered` in `grouping.ts`, which is
    // a compile error rather than a test, because that is what the question is.
    expect([...IMPACT_ORDER]).toEqual(['critical', 'serious', 'moderate', 'minor', null]);
  });

  it('groups one of each without losing any', () => {
    const oneOfEach = IMPACT_ORDER.map((impact) => violation(impact));

    expect(groupByImpact(oneOfEach)).toHaveLength(IMPACT_ORDER.length);
  });
});

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
