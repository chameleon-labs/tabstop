import type { AuditModel } from '../models/audit.js'
import type { ViolationModel } from '../models/violation.js'

export type AuditResult = {
  audit: AuditModel
  violations: ViolationModel[]
}

export interface LoadAuditResult {
  /** Null when no audit carries that public uuid, including a malformed one. */
  load: (publicUuid: string) => Promise<AuditResult | null>
}
