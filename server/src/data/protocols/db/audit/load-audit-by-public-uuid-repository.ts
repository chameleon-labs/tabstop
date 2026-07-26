import type { AuditModel } from '../../../../domain/models/audit.js'

export interface LoadAuditByPublicUuidRepository {
  loadByPublicUuid: (publicUuid: string) => Promise<AuditModel | null>
}
