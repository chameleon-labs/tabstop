import type { JobQueue } from '../../data/protocols/queue/job-queue.js'
import type { PayloadQueue } from './helpers/bullmq-helper.js'
import type { AuditJob, AuditJobQueue } from '../../data/protocols/queue/audit-job-queue.js'

export class BullMqJobQueue<TPayload> implements JobQueue<TPayload> {
  constructor (private readonly queue: PayloadQueue<TPayload>) {}

  async enqueue (payload: TPayload): Promise<void> {
    await this.queue.add(this.queue.name, payload)
  }
}

/**
 * Audit ids come from a bigserial, so every one of them is all digits - and
 * BullMQ rejects an all-digit custom id outright, because it would collide
 * with the ids BullMQ mints itself. The prefix is what makes them usable. It
 * cannot contain `:`, which BullMQ also rejects (it reserves that separator
 * for repeatable jobs). Both methods below have to derive the id identically,
 * or `has` looks up a key nothing ever wrote.
 */
const jobIdFor = (auditId: string): string => `audit-${auditId}`

/**
 * The audit queue, which needs more than fire-and-forget: submission has to be
 * able to retry safely and to ask whether a job it failed to confirm exists.
 */
export class BullMqAuditQueue implements AuditJobQueue {
  constructor (private readonly queue: PayloadQueue<AuditJob>) {}

  async enqueueOnce (job: AuditJob): Promise<void> {
    // BullMQ ignores an add whose job id already exists, which is what makes a
    // retry idempotent - without it, a reply lost after Redis committed would
    // leave two jobs racing for the same audit.
    await this.queue.add(this.queue.name, job, { jobId: jobIdFor(job.auditId) })
  }

  async has (auditId: string): Promise<boolean> {
    return await this.queue.getJob(jobIdFor(auditId)) !== undefined
  }

  /**
   * Waiting AND delayed - not active, not failed, not completed.
   *
   * Delayed is in here because in this queue it means one thing only: a job
   * that threw and is inside its retry backoff. The queue's defaults are
   * three attempts with exponential backoff from one second, and nothing
   * enqueues an audit with a delay of its own, so every delayed job is
   * accepted work that returns to the runnable line within a couple of
   * seconds and takes a worker slot when it does. Counting waiting alone
   * makes the depth dip below the truth for the length of that backoff.
   *
   * The window is small, so this is not the difference between a bounded and
   * an unbounded queue - the retries come back and the cap re-engages either
   * way. It is about which way an imprecise cost control should be wrong:
   * undercounting fails open, and the whole point of the cap is that the
   * expensive direction is the one to refuse.
   *
   * Active is left out: it is bounded by the workers' own concurrency, not by
   * anything a submitter can drive, so it would add a constant to the number
   * without telling submission anything it can act on.
   */
  async backlogCount (): Promise<number> {
    return await this.queue.getJobCountByTypes('waiting', 'delayed')
  }
}
