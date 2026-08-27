import type {Impact, Violation} from '@tabstop/contract';

export const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor', null] as const;

type MustBeNever<T extends never> = T;
type UnorderedImpact = Exclude<Impact, (typeof IMPACT_ORDER)[number]>;
export type AllImpactsOrdered = MustBeNever<UnorderedImpact>;

export const IMPACT_LABELS: Readonly<Record<Impact | 'unrated', string>> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
  unrated: 'Unrated',
};

export const EXPAND_ALL_BELOW = 4;

export const startsExpanded = (total: number): boolean => total < EXPAND_ALL_BELOW;

export const bySeverity = (violations: readonly Violation[]): Violation[] =>
  violations.toSorted((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact));
