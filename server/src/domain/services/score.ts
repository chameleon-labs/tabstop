import type {CountsByImpact, Impact} from '../models/impact.js';

const WEIGHTS: Record<Impact, number> = {
  critical: 10,
  serious: 5,
  moderate: 2,
  minor: 1,
};

const UNKNOWN_IMPACT_WEIGHT = 1;

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

const severityRank = (impact: Impact | null): number => (impact === null ? -1 : WEIGHTS[impact]);

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

export const summariseViolations = (violations: readonly ScoredViolation[]): AuditSummary => {
  const rules = mergeByRule(violations);

  const deductions = rules.reduce(
    (total, rule) => total + weightOf(rule.impact) * Math.min(rule.nodeCount, MAX_ELEMENTS_PER_RULE),
    0,
  );

  const countsByImpact: CountsByImpact = {minor: 0, moderate: 0, serious: 0, critical: 0};
  for (const rule of rules) {
    if (rule.impact === null) {
      continue;
    }
    countsByImpact[rule.impact] += rule.nodeCount;
  }

  return {
    score: Math.max(0, MAX_SCORE - deductions),
    countsByImpact,
  };
};
