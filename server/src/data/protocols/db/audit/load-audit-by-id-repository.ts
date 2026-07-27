import type { AuditModel } from '../../../../domain/models/audit.js'

/**
 * Internal lookup by primary key. Distinct from loadByPublicUuid, which is the
 * public share path (#23) and takes the unguessable id the world sees.
 */
export interface LoadAuditByIdRepository {
  loadById: (auditId: string) => Promise<AuditModel | null>
}
