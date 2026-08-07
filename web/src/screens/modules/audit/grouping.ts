import type { Impact, Violation } from '@tabstop/contract'

/**
 * Most severe first, which is also the order they should be fixed in.
 *
 * `null` is a real member, not a gap: axe reports violations with no severity,
 * and dropping them - or sorting them alongside `minor` - would hide findings
 * that are genuinely findings. Last, because unknown severity is not high.
 */
export const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor', null] as const

/**
 * Fails to compile if the contract gains an `Impact` that is not ordered above.
 *
 * At the type level because exhaustiveness over a union is a type-level
 * question. The runtime test that tried built its fixture by mapping
 * `IMPACT_ORDER`, so both sides came from the same array and a fifth impact
 * left them equal while every finding carrying it was dropped.
 */
type MustBeNever<T extends never> = T
type UnorderedImpact = Exclude<Impact, (typeof IMPACT_ORDER)[number]>
export type AllImpactsOrdered = MustBeNever<UnorderedImpact>

/**
 * Keyed on `Impact | 'unrated'` rather than `string`, so a new impact is a
 * compile error here too - an unlabelled group reads like a bug.
 */
export const IMPACT_LABELS: Readonly<Record<Impact | 'unrated', string>> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
  unrated: 'Unrated'
}

/** The key an unrated group is addressed by, since `null` is not a usable key. */
export const UNRATED = 'unrated'

export const impactKey = (impact: Impact | null): Impact | typeof UNRATED => impact ?? UNRATED

export type ViolationGroup = {
  impact: Impact | null
  key: Impact | typeof UNRATED
  label: string
  violations: Violation[]
}

/**
 * Groups in fixed severity order, omitting the ones with nothing in them.
 *
 * "Critical (0)" reads as a finding at a glance, and the counts beside the
 * score already say what is absent.
 */
export const groupByImpact = (violations: readonly Violation[]): ViolationGroup[] =>
  IMPACT_ORDER
    .map((impact) => {
      const key = impactKey(impact)
      return {
        impact,
        key,
        label: IMPACT_LABELS[key],
        violations: violations.filter((violation) => violation.impact === impact)
      }
    })
    .filter((group) => group.violations.length > 0)

/**
 * Below this many findings in total, everything starts open.
 *
 * Two problems should be shown rather than hidden behind two clicks; forty
 * expanded findings is a wall rather than a list. A judgement rather than a
 * measurement, which is why it is named and tested rather than inlined.
 */
export const EXPAND_ALL_BELOW = 4

export const startsExpanded = (total: number): boolean => total < EXPAND_ALL_BELOW

/**
 * The total across every group.
 *
 * Not `countsByImpact` summed: that counts only rated violations, so an unrated
 * finding would be invisible to the expand rule while visible on screen.
 */
export const totalViolations = (violations: readonly Violation[]): number => violations.length
