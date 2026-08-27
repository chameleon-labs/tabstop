import type {AuditModel} from '../models/audit.js';
import type {UrlRejection} from '../services/url-safety.js';

export type RequestAuditParams = {
  url: string;
};

export type RequestAuditResult =
  | {outcome: 'queued'; audit: AuditModel}
  | {outcome: 'rejected'; reason: UrlRejection}
  | {outcome: 'unavailable'};

export interface RequestAudit {
  request: (params: RequestAuditParams) => Promise<RequestAuditResult>;
}
