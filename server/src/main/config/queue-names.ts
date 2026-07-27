export const QUEUE_NAMES = {
  ping: 'ping',
  audit: 'audit'
} as const

export type PingPayload = {
  requestedAt: string
}

/**
 * Only the id travels. The URL is read from the row so a job that sat in the
 * queue cannot audit a URL the audit no longer refers to.
 */
export type AuditPayload = {
  auditId: string
}
