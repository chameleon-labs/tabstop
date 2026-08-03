/**
 * The audit endpoints, as they appear on the wire.
 *
 * These are deliberately NOT the server's domain models, and not re-exports of
 * them. `domain/` may import nothing but relative paths - `architecture.spec.ts`
 * asserts it - so a domain model cannot be declared here, and this package sits
 * below the server so it cannot reach the other way either. The layering makes
 * the redeclaration compulsory rather than accidental.
 *
 * What keeps the two honest is `presentation/helpers/audit-view.ts`: its mapper
 * is annotated with `AuditResultResponse`, and it carries explicit exactness
 * assertions for the unions below. Widen `AuditStatus` or `Impact` in the domain
 * without widening it here and `pnpm typecheck` fails in the server.
 */

/**
 * Severity as axe reports it.
 *
 * Ordered least to most severe, which is also the order `CountsByImpact` is
 * written in. Nothing depends on the declaration order - a UI that wants to sort
 * should say so - but keeping it consistent means a reader never has to check.
 */
export type Impact = 'minor' | 'moderate' | 'serious' | 'critical'

export type CountsByImpact = Record<Impact, number>

export type AuditStatus = 'queued' | 'running' | 'done' | 'failed'

export type ViolationNode = {
  /** The axe selector chain that locates the element. */
  target: string[]
  /**
   * A markup snippet captured from an arbitrary third-party page.
   *
   * Rendered AS TEXT, never as markup. React escapes by default, so the whole
   * rule is that `dangerouslySetInnerHTML` never touches this field. This is the
   * specific exposure that motivated an httpOnly session cookie over a
   * JS-readable token, and the two should stay connected in the reader's mind.
   */
  html: string
}

/**
 * Named and exported rather than inlined into the response, because three
 * surfaces consume it - live progress (#19), audit detail (#21) and the share
 * page (#23) - and each wants to type a component against a single violation
 * without reaching into the response type to extract it.
 */
export type Violation = {
  ruleId: string
  /**
   * Null when axe reports no severity. Load-bearing: such violations are real
   * findings, and treating the null as "no problem" hides them.
   */
  impact: Impact | null
  description: string
  helpUrl: string
  nodes: ViolationNode[]
}

/**
 * One shape for all four states, so a client narrows on `status` rather than
 * handling four different response types.
 */
export type AuditResultResponse = {
  /** The public uuid. The server's internal id is never on the wire. */
  auditId: string
  url: string
  status: AuditStatus
  createdAt: string
  completedAt: string | null
  score: number | null
  countsByImpact: CountsByImpact
  axeVersion: string | null
  /**
   * False means the page never finished loading, so a clean score here is
   * provisional rather than a fact. Surfaced, not swallowed.
   */
  settled: boolean
  error: string | null
  violations: Violation[]
}

/** `POST /api/audits`, 202. */
export type RequestAuditResponse = {
  auditId: string
  status: AuditStatus
  /**
   * How long to wait before polling. Comes from the server precisely so the
   * interval can be widened without a frontend deploy - a client that picks its
   * own number takes that lever away.
   */
  pollAfterMs: number
}
