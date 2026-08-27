import type {AuditStatus, CountsByImpact} from './audit.js';

export type PageLimitReachedBody = {
  code: 'page_limit_reached';
  error: string;
  limit: number;
};

export type PageAlreadyTrackedBody = {
  code: 'page_already_tracked';
  error: string;
};

export type PageConflictBody = PageLimitReachedBody | PageAlreadyTrackedBody;

export type PageConflictCode = PageConflictBody['code'];

export type AuditInFlightBody = {
  code: 'audit_in_flight';
  error: string;
};

export type OnDemandAuditSpentBody = {
  code: 'on_demand_audit_spent';
  error: string;
  resetAt: string;
};

export type PageAuditConflictBody = AuditInFlightBody | OnDemandAuditSpentBody;

export type PageAuditConflictCode = PageAuditConflictBody['code'];

export type PageView = {
  id: string;
  url: string;
  monitoringEnabled: boolean;
  createdAt: string;
};

export type LatestPageAudit = {
  auditId: string;
  status: AuditStatus;
  score: number | null;
  countsByImpact: CountsByImpact;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

export type PageScorePoint = {score: number; at: string};

export type PageSummary = PageView & {
  domain: string;
  latestAudit: LatestPageAudit | null;
  score: number | null;
  previousScore: number | null;
  history: PageScorePoint[];
  nextAuditAt: string | null;
};

export type LoadPagesResponse = {
  pages: PageSummary[];
  limit: number;
  used: number;
};

export type PageHistoryPoint = {
  auditId: string;
  createdAt: string;
  status: AuditStatus;
  score: number | null;
  countsByImpact: CountsByImpact;
  axeVersion: string | null;
};

export type PageHistoryResponse = {
  pageId: string;
  url: string;
  days: number;
  points: PageHistoryPoint[];
};

export type AddPageResponse = PageView & {firstAuditId: string | null};

export type UpdatePageResponse = PageView;
