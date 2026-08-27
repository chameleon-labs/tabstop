import type {AuditModel} from '../../../../domain/models/audit.js';

export type AddScheduledAuditParams = {
  pageId: string;
  url: string;
  scheduledFor: string;
};

export interface AddScheduledAuditRepository {
  addScheduled: (params: AddScheduledAuditParams) => Promise<AuditModel | null>;
}
