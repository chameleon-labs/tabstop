import type { AuditStatus } from '../../domain/models/audit.js'
import type { CountsByImpact, Impact } from '../../domain/models/impact.js'
import type { ViolationNode } from '../../domain/models/violation.js'
import type { AuditResult } from '../../domain/usecases/load-audit-result.js'

/**
 * One violation as the API reports it. Named and exported because three
 * surfaces consume this response - live progress (#19), the share page (#23)
 * and audit detail (#21) - and each wants to type a component against a single
 * violation without reaching into the response type to extract it.
 */
export type Violation = {
  ruleId: string
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
  auditId: string
  url: string
  status: AuditStatus
  createdAt: string
  completedAt: string | null
  score: number | null
  countsByImpact: CountsByImpact
  axeVersion: string | null
  settled: boolean
  error: string | null
  violations: Violation[]
}

/**
 * Every field is named deliberately.
 *
 * This response is public, gated only by an unguessable uuid, and `AuditModel`
 * carries `pageId` - which links to a site and therefore to an account.
 * Spreading the model here, or a later `select *`, is exactly how that reaches
 * the wire. Naming each field means a new column cannot leak by default.
 */
export const toAuditResultResponse = (result: AuditResult): AuditResultResponse => ({
  // The public uuid, never the bigserial primary key.
  auditId: result.audit.publicUuid,
  url: result.audit.url,
  status: result.audit.status,
  createdAt: result.audit.createdAt.toISOString(),
  completedAt: result.audit.completedAt?.toISOString() ?? null,
  score: result.audit.score,
  countsByImpact: result.audit.countsByImpact,
  axeVersion: result.audit.axeVersion,
  // False means the page never finished loading, so a clean score here is
  // provisional rather than a fact.
  settled: result.audit.settled,
  error: result.audit.error,
  violations: result.violations.map((violation) => ({
    ruleId: violation.ruleId,
    impact: violation.impact,
    description: violation.description,
    helpUrl: violation.helpUrl,
    nodes: violation.nodes
  }))
})
