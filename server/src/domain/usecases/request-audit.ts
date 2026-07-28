import type { AuditModel } from '../models/audit.js'
import type { UrlRejection } from '../services/url-safety.js'

export type RequestAuditParams = {
  url: string
}

/**
 * Three expected outcomes rather than exceptions for two of them: a rejected
 * URL and an unreachable queue are both ordinary results, and the controller
 * maps them to 400 and 503.
 */
export type RequestAuditResult =
  | { outcome: 'queued', audit: AuditModel }
  | { outcome: 'rejected', reason: UrlRejection }
  | { outcome: 'unavailable' }

export interface RequestAudit {
  request: (params: RequestAuditParams) => Promise<RequestAuditResult>
}
