import type { Impact } from '../models/impact.js'

export type ViolationSnapshot = {
  ruleId: string
  impact: Impact | null
}

export type AuditSnapshot = {
  score: number
  axeVersion: string
  violations: readonly ViolationSnapshot[]
}

export type ViolationDiff<
  Current extends ViolationSnapshot = ViolationSnapshot,
  Previous extends ViolationSnapshot = ViolationSnapshot
> = {
  added: Current[]
  fixed: Previous[]
  unchanged: Current[]
}

export type RegressionResult =
  | { kind: 'none' }
  | { kind: 'score_drop', delta: number }
  | { kind: 'new_critical', ruleIds: string[] }

/**
 * The shared rule-level comparison for alerting and the audit diff UI (#22).
 *
 * The objects themselves are preserved so each consumer keeps the details
 * from the side where a rule exists: current details for added/unchanged,
 * previous details for fixed.
 */
export const diffViolations = <
  Current extends ViolationSnapshot,
  Previous extends ViolationSnapshot
> (
    current: readonly Current[],
    previous: readonly Previous[]
  ): ViolationDiff<Current, Previous> => {
  const previousRuleIds = new Set(previous.map((violation) => violation.ruleId))
  const currentRuleIds = new Set(current.map((violation) => violation.ruleId))

  return {
    added: current.filter((violation) => !previousRuleIds.has(violation.ruleId)),
    fixed: previous.filter((violation) => !currentRuleIds.has(violation.ruleId)),
    unchanged: current.filter((violation) => previousRuleIds.has(violation.ruleId))
  }
}

/**
 * Chooses at most one alert signal for a completed audit.
 *
 * Engine changes suppress the whole comparison: axe can add or reclassify
 * rules between releases, and presenting that as a page regression would make
 * every monitored page cry wolf at once.
 */
export const detectRegression = (
  current: AuditSnapshot,
  previous: AuditSnapshot | null,
  threshold: number
): RegressionResult => {
  if (previous === null || previous.axeVersion !== current.axeVersion) {
    return { kind: 'none' }
  }

  const newSevereRuleIds = diffViolations(current.violations, previous.violations)
    .added
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(({ ruleId }) => ruleId)

  if (newSevereRuleIds.length > 0) {
    return { kind: 'new_critical', ruleIds: [...new Set(newSevereRuleIds)] }
  }

  const delta = previous.score - current.score
  return delta >= threshold ? { kind: 'score_drop', delta } : { kind: 'none' }
}
