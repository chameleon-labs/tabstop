import type {AuditModel} from '../../../../domain/models/audit.js';

export type AddAuditParams = {
  url: string;
  /** Null for a one-off anonymous audit. */
  pageId: string | null;
};

export interface AddAuditRepository {
  add: (params: AddAuditParams) => Promise<AuditModel>;
}
