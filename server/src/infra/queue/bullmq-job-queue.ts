import type { JobQueue } from '../../data/protocols/queue/job-queue.js'
import type { PayloadQueue } from './helpers/bullmq-helper.js'
import type {
  AuditJob, AuditJobQueue, EnqueueOptions
} from '../../data/protocols/queue/audit-job-queue.js'

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

  async enqueueOnce (job: AuditJob, options?: EnqueueOptions): Promise<void> {
    // BullMQ ignores an add whose job id already exists, which is what makes a
    // retry idempotent - without it, a reply lost after Redis committed would
    // leave two jobs racing for the same audit.
    //
    // The delay is omitted rather than passed as zero when there is none, so
    // an interactive submission's job options stay exactly what they were.
    await this.queue.add(this.queue.name, job, {
      jobId: jobIdFor(job.auditId),
      ...(options === undefined ? {} : { delay: options.delayMs })
    })
  }

  async has (auditId: string): Promise<boolean> {
    return await this.queue.getJob(jobIdFor(auditId)) !== undefined
  }

  /**
   * The states in which BullMQ still owes this job a worker.
   *
   * `completed` and `failed` are the ones deliberately absent: both are
   * terminal, and both linger - `removeOnComplete` keeps a job for an hour,
   * `removeOnFail` for a day, and the cleanup only runs when the queue is
   * otherwise busy. Anything reading "a record exists" as "work is coming"
   * inherits that retention as a delay.
   *
   * `unknown` is treated as pending: BullMQ returns it for a job it found but
   * could not place, which is not evidence that nothing will run it.
   */
  private static readonly PENDING_STATES = new Set([
    'waiting', 'waiting-children', 'prioritized', 'active', 'delayed', 'unknown'
  ])

  async isPending (auditId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobIdFor(auditId))
    if (job === undefined) return false

    return BullMqAuditQueue.PENDING_STATES.has(await job.getState())
  }

  /**
   * Waiting only - not delayed, not active, not failed, not completed.
   *
   * This counted `delayed` as well, on a premise that was true when it was
   * written and that #13 removed: "nothing enqueues an audit with a delay of
   * its own, so every delayed job is a retry that returns to the runnable line
   * within a couple of seconds". The daily scheduler enqueues the whole
   * night's work with delays of up to six hours, deliberately, so that tabstop
   * does not arrive at one origin all at once.
   *
   * Left as it was, those jobs would be counted as backlog. A hundred
   * monitored pages would put the depth over AUDIT_QUEUE_MAX_DEPTH the moment
   * the fan-out ran, and `POST /api/audits` - the product's hook - would
   * answer 503 for the length of the window, every night, while the workers
   * sat idle. That is not the bound failing safe; it is the bound measuring
   * the wrong thing.
   *
   * What counting waiting alone gives up is the retry-backoff window the old
   * comment was protecting: a job that threw is uncounted until it comes back.
   * That undercounts, which is the direction this comment already argued an
   * imprecise cost control should be wrong - and the delayed jobs are not
   * lost, they enter `waiting` as their time arrives, so a genuinely saturated
   * worker still refuses submissions. What changed is only that work scheduled
   * into the future stops being charged as if it were queued now.
   *
   * The residual is real and bounded: against a handler that fails fast, the
   * queue can hold roughly `attempts` times the cap in work that is coming
   * back. Pinned by a spec rather than left as a claim. Separating the two
   * kinds of delay needs the scheduler's off this queue entirely, which is
   * #51 - not something to smuggle into the count here.
   *
   * Active is left out for the reason it always was: it is bounded by the
   * workers' own concurrency rather than by anything a submitter can drive.
   */
  async backlogCount (): Promise<number> {
    return await this.queue.getJobCountByTypes('waiting')
  }
}
