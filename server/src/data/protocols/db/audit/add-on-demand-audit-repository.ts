import type {AuditModel} from '../../../../domain/models/audit.js';

export type AddOnDemandAuditParams = {
  userId: string;
  pageId: string;
  day: string;
  allowance: number;
};

export type AddOnDemandAuditResult =
  | {outcome: 'added'; audit: AuditModel}
  | {outcome: 'not-found'}
  | {outcome: 'in-flight'}
  | {outcome: 'allowance-spent'};

export interface AddOnDemandAuditRepository {
  addOnDemand: (params: AddOnDemandAuditParams) => Promise<AddOnDemandAuditResult>;
}

export interface ReleaseOnDemandAuditRepository {
  releaseOnDemand: (auditId: string) => Promise<void>;
}
