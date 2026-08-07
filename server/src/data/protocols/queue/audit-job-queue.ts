export type AuditJob = {auditId: string};

/**
 * How long the queue should hold the job before a worker may take it.
 *
 * Optional at every call site because interactive submission wants zero -
 * somebody is watching a spinner. The daily scheduler (#13) is the one caller
 * that wants a delay, and it wants a large one: the night's work spread over
 * hours so tabstop does not arrive at one origin all at once.
 */
export type EnqueueOptions = {delayMs: number};

/**
 * The audit queue as submission needs it: not fire-and-forget, but a queue a
 * failed request can retry into safely and can then ask what it holds.
 */
export interface AuditJobQueue {
  /**
   * Enqueues the audit under an id derived from the audit itself, so calling
   * it twice - a retry after a lost reply - still enqueues one job.
   */
  enqueueOnce: (job: AuditJob, options?: EnqueueOptions) => Promise<void>;
  /**
   * Whether the queue holds a record for this audit at all, in any state.
   *
   * The question submission asks after an enqueue it could not confirm: did
   * my add land? A job that has already run answers yes, and must - the audit
   * happened, so the row it points at has to stay.
   */
  has: (auditId: string) => Promise<boolean>;
  /**
   * Whether the queue still INTENDS to run this audit - waiting, delayed or
   * active, rather than a terminal record kept around for inspection.
   *
   * A different question from `has`, and the reclaim pass needs this one.
   * Terminal jobs linger: `removeOnFail` keeps a failed job for a day, and
   * the cleanup is lazy on top of that. Asking `has` there reads "a record
   * exists" as "work is coming", so an audit whose job exhausted its attempts
   * without ever writing a terminal status would keep its page out of the
   * worklist for as long as the record survived.
   */
  isPending: (auditId: string) => Promise<boolean>;
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
  backlogCount: () => Promise<number>;
}
