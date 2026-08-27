import type {AuditModel} from '../../../../domain/models/audit.js';

export interface LoadAuditByIdRepository {
  loadById: (auditId: string) => Promise<AuditModel | null>;
}
