import type {AuditModel} from './audit.js';

export type PageModel = {
  id: string;
  siteId: string;
  url: string;
  monitoringEnabled: boolean;
  createdAt: Date;
};

export type PageScorePoint = {
  score: number;
  at: Date;
};

export type PageSummary = {
  page: PageModel;
  domain: string;
  latestAudit: AuditModel | null;
  history: PageScorePoint[];
};

export type ScheduledPageSummary = PageSummary & {
  nextAuditAt: Date | null;
};
