import type {AuditModel} from '../models/audit.js';

export type RequestPageAuditParams = {
  userId: string;
  pageId: string;
};

export type RequestPageAuditResult =
  | {outcome: 'queued'; audit: AuditModel}
  | {outcome: 'not-found'}
  | {outcome: 'in-flight'}
  | {outcome: 'allowance-spent'; resetAt: Date}
  | {outcome: 'unavailable'};

export interface RequestPageAudit {
  request: (params: RequestPageAuditParams) => Promise<RequestPageAuditResult>;
}
