export type AuditJob = { auditId: string }

/**
 * The audit queue as submission needs it: not fire-and-forget, but a queue a
 * failed request can retry into safely and can then ask what it holds.
 */
export interface AuditJobQueue {
  /**
   * Enqueues the audit under an id derived from the audit itself, so calling
   * it twice - a retry after a lost reply - still enqueues one job.
   */
  enqueueOnce: (job: AuditJob) => Promise<void>
  /** Whether the queue already holds the job for this audit. */
  has: (auditId: string) => Promise<boolean>
}
