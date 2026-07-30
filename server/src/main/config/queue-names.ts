export const QUEUE_NAMES = {
  ping: 'ping',
  audit: 'audit',
  reaudit: 'reaudit'
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

/**
 * Nothing travels at all: the nightly fan-out reads the clock itself.
 *
 * A `scheduledFor` in the payload would be the time the SCHEDULER fired,
 * which is the wrong thing for a job that may be retried an hour later after
 * a Redis outage - it would keep stamping rows with a day that has passed.
 */
export type ReauditPayload = Record<string, never>
