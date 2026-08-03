import type {
  AuditResultResponse,
  AuditStatus as WireStatus,
  Impact as WireImpact,
  RequestAuditResponse,
  ViolationNode as WireViolationNode
} from '@tabstop/contract'
import type { AuditModel, AuditStatus } from '../../domain/models/audit.js'
import type { Impact } from '../../domain/models/impact.js'
import type { ViolationNode } from '../../domain/models/violation.js'
import type { AuditResult } from '../../domain/usecases/load-audit-result.js'
import type { Exact, MustHold } from './contract-proof.js'

/**
 * Widen either side of any of these without the other and `pnpm typecheck`
 * fails here, naming the type that moved - rather than on a frontend that has
 * quietly become wrong about the payload. See `contract-proof.ts` for why the
 * return-type annotation below is not sufficient on its own.
 */
type StatusMatches = MustHold<Exact<AuditStatus, WireStatus>>
type ImpactMatches = MustHold<Exact<Impact, WireImpact>>
type NodeMatches = MustHold<Exact<ViolationNode, WireViolationNode>>

/**
 * Exported so the assertions above are instantiated rather than merely
 * declared, and so deleting one is a visible change to this file's surface
 * rather than the removal of something that looked unused.
 */
export type ContractProof = [StatusMatches, ImpactMatches, NodeMatches]

/**
 * Every field is named deliberately.
 *
 * This response is public, gated only by an unguessable uuid, and `AuditModel`
 * carries `pageId` - which links to a site and therefore to an account.
 * Spreading the model here, or a later `select *`, is exactly how that reaches
 * the wire. Naming each field means a new column cannot leak by default.
 *
 * The mapper stays in the server for that reason. `@tabstop/contract` carries
 * the transport types and nothing else; this function is the boundary those
 * types describe, and must not follow them out of the server.
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

/**
 * The 202 from `POST /api/audits`.
 *
 * Named and annotated rather than built inline in the controller, because it is
 * as much a published shape as the GET response is - the frontend types its
 * mutation against `RequestAuditResponse`, and `pollAfterMs` is the value it
 * then feeds back into polling. Built inline, renaming any of these three
 * fields would typecheck on both sides and surface as a client that polls
 * forever with an undefined interval.
 *
 * `status` is the domain's, which `StatusMatches` above already pins to the
 * wire union, so widening `AuditStatus` fails here too.
 */
export const toRequestAuditResponse = (
  audit: AuditModel, pollAfterMs: number
): RequestAuditResponse => ({
  // The public uuid only. The internal id is never exposed.
  auditId: audit.publicUuid,
  status: audit.status,
  pollAfterMs
})
