import type { AddViolationParams } from '../db/violation/violation-params.js'

export type AuditPageResult = {
  /** Already in the repository's shape - no engine type crosses this boundary. */
  violations: AddViolationParams[]
  axeVersion: string
  durationMs: number
  /** False when the page never reached network idle and was audited anyway. */
  settled: boolean
}

export interface PageAuditor {
  audit: (url: string, signal: AbortSignal) => Promise<AuditPageResult>
}
