import type { ViolationModel } from '../../../../domain/models/violation.js'

export interface LoadViolationsByAuditIdRepository {
  loadByAuditId: (auditId: string) => Promise<ViolationModel[]>
}
