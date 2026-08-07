import type {JobQueue} from '../../data/protocols/queue/job-queue.js';
import type {PayloadQueue} from './helpers/bullmq-helper.js';
import type {AuditJob, AuditJobQueue, EnqueueOptions} from '../../data/protocols/queue/audit-job-queue.js';

export class BullMqJobQueue<TPayload> implements JobQueue<TPayload> {
  constructor(private readonly queue: PayloadQueue<TPayload>) {}

  async enqueue(payload: TPayload): Promise<void> {
    await this.queue.add(this.queue.name, payload);
  }
}

/**
 * Audit ids are all digits, and BullMQ rejects an all-digit custom id because
 * it would collide with its own. The prefix cannot contain `:` either, which
 * BullMQ reserves for repeatable jobs. Both methods below must derive the id
 * identically, or `has` looks up a key nothing ever wrote.
 */
const jobIdFor = (auditId: string): string => `audit-${auditId}`;

/**
 * The audit queue, which needs more than fire-and-forget: submission has to be
 * able to retry safely and to ask whether a job it failed to confirm exists.
 */
export class BullMqAuditQueue implements AuditJobQueue {
  constructor(private readonly queue: PayloadQueue<AuditJob>) {}

  async enqueueOnce(job: AuditJob, options?: EnqueueOptions): Promise<void> {
    // BullMQ ignores an add whose job id already exists, which is what makes a
    // retry idempotent - without it, a reply lost after Redis committed would
    // leave two jobs racing for the same audit.
    //
    // The delay is omitted rather than passed as zero when there is none, so
    // an interactive submission's job options stay exactly what they were.
    await this.queue.add(this.queue.name, job, {
      jobId: jobIdFor(job.auditId),
      ...(options === undefined ? {} : {delay: options.delayMs}),
    });
  }

  async has(auditId: string): Promise<boolean> {
    return (await this.queue.getJob(jobIdFor(auditId))) !== undefined;
  }

  /**
   * The states in which BullMQ still owes this job a worker.
   *
   * `completed` and `failed` are absent deliberately: both are terminal and
   * both linger - an hour and a day respectively - so anything reading "a
   * record exists" as "work is coming" inherits that retention as a delay.
   *
   * `unknown` counts as pending: BullMQ returns it for a job it found but
   * could not place, which is not evidence that nothing will run it.
   */
  private static readonly PENDING_STATES = new Set([
    'waiting',
    'waiting-children',
    'prioritized',
    'active',
    'delayed',
    'unknown',
  ]);

  async isPending(auditId: string): Promise<boolean> {
    const job = await this.queue.getJob(jobIdFor(auditId));
    if (job === undefined) return false;

    return BullMqAuditQueue.PENDING_STATES.has(await job.getState());
  }

  /**
   * Waiting only - not delayed, not active, not failed, not completed.
   *
   * `delayed` was counted until #13, on the premise that every delayed job was
   * a retry seconds from returning. The daily scheduler now enqueues a whole
   * night with delays of up to six hours, so counting them as backlog would
   * put a hundred monitored pages over AUDIT_QUEUE_MAX_DEPTH the moment the
   * fan-out ran - answering 503 on the product's hook every night while the
   * workers sat idle. Not the bound failing safe; the bound measuring the
   * wrong thing.
   *
   * The cost is that a job in retry backoff is uncounted until it returns,
   * which UNDERCOUNTS - the direction an imprecise cost control should err.
   * Delayed jobs still enter `waiting` as their time arrives, so a genuinely
   * saturated worker refuses submissions. The residual is bounded at roughly
   * `attempts` times the cap against a fast-failing handler, and pinned by a
   * spec. Separating the two kinds of delay needs the scheduler off this queue
   * entirely, which is #51.
   *
   * Active is excluded because it is bounded by the workers' own concurrency
   * rather than by anything a submitter can drive.
   */
  async backlogCount(): Promise<number> {
    return await this.queue.getJobCountByTypes('waiting');
  }
}
