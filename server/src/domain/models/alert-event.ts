export type AlertKind = 'score_drop' | 'new_critical'

export type AlertEventModel = {
  id: string
  pageId: string
  auditId: string
  /** Nulled when the audit it compared against is deleted by retention. */
  previousAuditId: string | null
  kind: AlertKind
  /** When the regression was detected (#14). What the daily dedupe keys on. */
  createdAt: Date
  /** Null until a confirmed send (#15); stays null when delivery fails. */
  emailedAt: Date | null
}
