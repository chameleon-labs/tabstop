import type {CountsByImpact, Impact} from '../models/impact.js';

/**
 * axe-core deliberately produces no score, so this one is opinionated. It
 * exists to make regression visible at a glance; the violation list is what
 * makes fixing possible.
 *
 * Fixed in v1 and deliberately not configurable: scores are only comparable
 * to each other because every page is scored the same way.
 */
const WEIGHTS: Record<Impact, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
};

/**
 * Two different things arrive as `impact: null`. axe genuinely reports it for
 * a violation whose failing checks carry no severity - and the auditor also
 * funnels any severity we do not model to null, rather than dropping a real
 * finding to keep the enum tidy.
 *
 * That second path is why unknown severity still deducts: if it did not, an
 * axe version introducing a new severity name would silently stop deducting
 * for every violation carrying it, and pages would drift toward 100 with no
 * code change and no error.
 *
 * Its own constant rather than `WEIGHTS.minor`, even though both are 1 today:
 * `?? 'minor'` invites a later reader to decide minor is too lenient and
 * raise it, which would move real minor violations too.
 */
const UNKNOWN_IMPACT_WEIGHT = 1;

/**
 * Load-bearing. Without it one unlabelled icon repeated 200 times zeroes an
 * otherwise fine page, and the score stops being usable for trending.
 */
const MAX_ELEMENTS_PER_RULE = 5;

const MAX_SCORE = 100;

export type ScoredViolation = {
  ruleId: string;
  impact: Impact | null;
  nodeCount: number;
};

export type AuditSummary = {
  score: number;
  countsByImpact: CountsByImpact;
};

type MergedRule = {
  impact: Impact | null;
  nodeCount: number;
};

const weightOf = (impact: Impact | null): number => (impact === null ? UNKNOWN_IMPACT_WEIGHT : WEIGHTS[impact]);

/**
 * Ranked by weight, so the severity ordering can never drift from the
 * deduction it causes. Unknown ranks below every known impact - it deducts at
 * minor's weight, but it must not displace a classification we actually have,
 * because the counts depend on that classification.
 */
const severityRank = (impact: Impact | null): number => (impact === null ? -1 : WEIGHTS[impact]);

/**
 * axe returns one entry per rule, so this is defensive - but about something
 * specific: the cap is per rule, so two entries for one rule apply it twice
 * and can deduct double for a single underlying problem.
 *
 * It merges rather than rejecting duplicates because this runs inside the
 * worker, after the page has been audited and after the violations have
 * already been committed. Throwing would turn a scoring nuance into a failed
 * audit and discard real results. The most severe impact wins because for a
 * regression monitor, understating severity is the worse direction to err in.
 */
const mergeByRule = (violations: readonly ScoredViolation[]): MergedRule[] => {
  const merged = new Map<string, MergedRule>();

  for (const violation of violations) {
    const existing = merged.get(violation.ruleId);

    if (existing === undefined) {
      merged.set(violation.ruleId, {
        impact: violation.impact,
        nodeCount: violation.nodeCount,
      });
      continue;
    }

    existing.nodeCount += violation.nodeCount;
    if (severityRank(violation.impact) > severityRank(existing.impact)) {
      existing.impact = violation.impact;
    }
  }

  return [...merged.values()];
};

/**
 * The score and the counts printed beside it, from one merge pass, so the two
 * can never disagree about what was found.
 *
 * Weights and element counts are integers, so the result is an integer in
 * [0, 100] by construction - which is what `audits.score` requires.
 */
export const summariseViolations = (violations: readonly ScoredViolation[]): AuditSummary => {
  const rules = mergeByRule(violations);

  const deductions = rules.reduce(
    (total, rule) => total + weightOf(rule.impact) * Math.min(rule.nodeCount, MAX_ELEMENTS_PER_RULE),
    0,
  );

  // Every key present, zeros included: `counts_by_impact` carries a check
  // constraint requiring all four, so a partial record is rejected outright.
  const countsByImpact: CountsByImpact = {minor: 0, moderate: 0, serious: 0, critical: 0};
  for (const rule of rules) {
    // A violation with no severity has no bucket, and inventing one would
    // corrupt the comparison regression detection makes between audits. It
    // still deducts, and it is still in the violation list.
    if (rule.impact === null) continue;
    countsByImpact[rule.impact] += rule.nodeCount;
  }

  return {
    score: Math.max(0, MAX_SCORE - deductions),
    countsByImpact,
  };
};
