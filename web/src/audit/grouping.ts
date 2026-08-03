import type { Impact, Violation } from '@tabstop/contract'

/**
 * Most severe first, which is also the order they should be fixed in.
 *
 * `null` is a real member of this list, not a gap in it. axe reports violations
 * with no severity, the contract keeps `impact` nullable for exactly that
 * reason, and dropping them - or quietly sorting them alongside `minor` -
 * would hide findings that are genuinely findings. They are last because
 * unknown severity is not high severity, and named rather than blank.
 */
export const IMPACT_ORDER: ReadonlyArray<Impact | null> = [
  'critical', 'serious', 'moderate', 'minor', null
]

export const IMPACT_LABELS: Readonly<Record<string, string>> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  minor: 'Minor',
  unrated: 'Unrated'
}

/** The key an unrated group is addressed by, since `null` is not a usable key. */
export const UNRATED = 'unrated'

export const impactKey = (impact: Impact | null): string => impact ?? UNRATED

export type ViolationGroup = {
  impact: Impact | null
  key: string
  label: string
  violations: Violation[]
}

/**
 * Groups in fixed severity order, omitting the ones with nothing in them.
 *
 * Empty groups are dropped rather than rendered as "Critical (0)". A list of
 * zeroes is noise on a clean page and, worse, reads as a finding at a glance -
 * the counts beside the score already say what is absent.
 */
export const groupByImpact = (violations: readonly Violation[]): ViolationGroup[] =>
  IMPACT_ORDER
    .map((impact) => {
      const key = impactKey(impact)
      return {
        impact,
        key,
        label: IMPACT_LABELS[key] ?? key,
        violations: violations.filter((violation) => violation.impact === impact)
      }
    })
    .filter((group) => group.violations.length > 0)

/**
 * Below this many findings in total, everything starts open.
 *
 * A page with two problems should show them, not make someone click twice to
 * find out what they are. A page with forty needs to be scannable first, and
 * forty expanded findings is not a list, it is a wall. The number is a
 * judgement rather than a measurement, which is why it is named and tested
 * rather than inlined into a component.
 */
export const EXPAND_ALL_BELOW = 4

export const startsExpanded = (total: number): boolean => total < EXPAND_ALL_BELOW

/**
 * The total across every group.
 *
 * Not `countsByImpact` summed: that record counts only rated violations, so an
 * unrated finding would be invisible to the expand rule while being visible on
 * screen - and the two disagreeing is how "why is this one collapsed" starts.
 */
export const totalViolations = (violations: readonly Violation[]): number => violations.length
