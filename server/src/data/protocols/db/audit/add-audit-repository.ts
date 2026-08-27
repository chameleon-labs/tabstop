import type {AuditModel} from '../../../../domain/models/audit.js';

export type AddAuditParams = {
  url: string;
  pageId: string | null;
};

export interface AddAuditRepository {
  add: (params: AddAuditParams) => Promise<AuditModel>;
}
