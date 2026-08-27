import type {
  AuditResultResponse,
  AuditStatus as WireStatus,
  Impact as WireImpact,
  RequestAuditResponse,
  ViolationNode as WireViolationNode,
} from '@tabstop/contract';
import type {AuditModel, AuditStatus} from '../../domain/models/audit.js';
import type {Impact} from '../../domain/models/impact.js';
import type {ViolationNode} from '../../domain/models/violation.js';
import type {AuditResult} from '../../domain/usecases/load-audit-result.js';
import type {Exact, MustHold} from './contract-proof.js';

type StatusMatches = MustHold<Exact<AuditStatus, WireStatus>>;
type ImpactMatches = MustHold<Exact<Impact, WireImpact>>;
type NodeMatches = MustHold<Exact<ViolationNode, WireViolationNode>>;

export type ContractProof = [StatusMatches, ImpactMatches, NodeMatches];

export const toAuditResultResponse = (result: AuditResult): AuditResultResponse => ({
  auditId: result.audit.publicUuid,
  url: result.audit.url,
  status: result.audit.status,
  createdAt: result.audit.createdAt.toISOString(),
  completedAt: result.audit.completedAt?.toISOString() ?? null,
  score: result.audit.score,
  countsByImpact: result.audit.countsByImpact,
  axeVersion: result.audit.axeVersion,
  settled: result.audit.settled,
  error: result.audit.error,
  violations: result.violations.map((violation) => ({
    ruleId: violation.ruleId,
    impact: violation.impact,
    description: violation.description,
    helpUrl: violation.helpUrl,
    nodes: violation.nodes,
  })),
});

export const toRequestAuditResponse = (audit: AuditModel, pollAfterMs: number): RequestAuditResponse => ({
  auditId: audit.publicUuid,
  status: audit.status,
  pollAfterMs,
});
