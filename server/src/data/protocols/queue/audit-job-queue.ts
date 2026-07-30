export type AuditJob = { auditId: string }

/**
 * How long the queue should hold the job before a worker may take it.
 *
 * Optional at every call site because interactive submission wants zero -
 * somebody is watching a spinner. The daily scheduler (#13) is the one caller
 * that wants a delay, and it wants a large one: the night's work spread over
 * hours so tabstop does not arrive at one origin all at once.
 */
export type EnqueueOptions = { delayMs: number }

/**
 * The audit queue as submission needs it: not fire-and-forget, but a queue a
 * failed request can retry into safely and can then ask what it holds.
 */
export interface AuditJobQueue {
  /**
   * Enqueues the audit under an id derived from the audit itself, so calling
   * it twice - a retry after a lost reply - still enqueues one job.
   */
  enqueueOnce: (job: AuditJob, options?: EnqueueOptions) => Promise<void>
  /** Whether the queue already holds the job for this audit. */
  has: (auditId: string) => Promise<boolean>
  /**
   * How much RUNNABLE accepted work the queue holds. Submission needs it
   * because a per-requester rate limit bounds one source and the queue is
   * shared by all of them: enough distinct sources, each politely inside its
   * own allowance, still drive the backlog to any length they collectively
   * want.
   *
   * Runnable, rather than everything pending: work deliberately scheduled
   * hours into the future does not count against it. The implementation
   * records why that distinction had to be drawn.
   */
  backlogCount: () => Promise<number>
}
