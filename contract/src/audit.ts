/**
 * The audit endpoints, as they appear on the wire.
 *
 * Deliberately NOT the server's domain models. `domain/` may import nothing but
 * relative paths and this package sits below the server, so neither side can
 * reach the other and the redeclaration is compulsory.
 *
 * `presentation/helpers/audit-view.ts` keeps the two honest: its mapper is
 * annotated with `AuditResultResponse` and asserts exactness for the unions
 * below, so widening one in the domain alone fails the server's typecheck.
 */

/**
 * Severity as axe reports it, ordered least to most severe - the same order
 * `CountsByImpact` is written in. Nothing depends on it; consistency just saves
 * the reader a check.
 */
export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

export type CountsByImpact = Record<Impact, number>;

export type AuditStatus = 'queued' | 'running' | 'done' | 'failed';

export type ViolationNode = {
  /** The axe selector chain that locates the element. */
  target: string[];
  /**
   * A markup snippet captured from an arbitrary third-party page.
   *
   * Rendered AS TEXT, never as markup: React escapes by default, so the rule is
   * that `dangerouslySetInnerHTML` never touches this field. The same exposure
   * is why the session is an httpOnly cookie rather than a JS-readable token.
   */
  html: string;
};

/**
 * Named rather than inlined into the response: three surfaces consume it -
 * live progress (#19), audit detail (#21), the share page (#23) - and each
 * types a component against a single violation.
 */
export type Violation = {
  ruleId: string;
  /**
   * Null when axe reports no severity. Load-bearing: those are real findings,
   * and reading the null as "no problem" hides them.
   */
  impact: Impact | null;
  description: string;
  helpUrl: string;
  nodes: ViolationNode[];
};

/**
 * One shape for all four states, so a client narrows on `status` rather than
 * handling four different response types.
 */
export type AuditResultResponse = {
  /** The public uuid. The server's internal id is never on the wire. */
  auditId: string;
  url: string;
  status: AuditStatus;
  createdAt: string;
  completedAt: string | null;
  score: number | null;
  countsByImpact: CountsByImpact;
  axeVersion: string | null;
  /**
   * False means the page never finished loading, so a clean score here is
   * provisional rather than a fact. Surfaced, not swallowed.
   */
  settled: boolean;
  error: string | null;
  violations: Violation[];
};

/** `POST /api/audits`, 202. */
export type RequestAuditResponse = {
  auditId: string;
  status: AuditStatus;
  /**
   * How long to wait before polling. From the server so the interval can be
   * widened without a frontend deploy.
   */
  pollAfterMs: number;
};
