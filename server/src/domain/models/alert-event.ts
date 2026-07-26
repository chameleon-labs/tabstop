export type AlertKind = 'score_drop' | 'new_critical'

export type AlertEventModel = {
  id: string
  pageId: string
  auditId: string
  /** Nulled when the audit it compared against is deleted by retention. */
  previousAuditId: string | null
  kind: AlertKind
  emailedAt: Date
}
