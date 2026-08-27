export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

export type CountsByImpact = Record<Impact, number>;

export type AuditStatus = 'queued' | 'running' | 'done' | 'failed';

export type ViolationNode = {
  target: string[];
  html: string;
};

export type Violation = {
  ruleId: string;
  impact: Impact | null;
  description: string;
  helpUrl: string;
  nodes: ViolationNode[];
};

export type AuditResultResponse = {
  auditId: string;
  url: string;
  status: AuditStatus;
  createdAt: string;
  completedAt: string | null;
  score: number | null;
  countsByImpact: CountsByImpact;
  axeVersion: string | null;
  settled: boolean;
  error: string | null;
  violations: Violation[];
};

export type RequestAuditResponse = {
  auditId: string;
  status: AuditStatus;
  pollAfterMs: number;
};
