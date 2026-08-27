import type {JobQueue} from '../../data/protocols/queue/job-queue.js';
import type {PayloadQueue} from './helpers/bullmq-helper.js';
import type {AuditJob, AuditJobQueue, EnqueueOptions} from '../../data/protocols/queue/audit-job-queue.js';

export class BullMqJobQueue<TPayload> implements JobQueue<TPayload> {
  constructor(private readonly queue: PayloadQueue<TPayload>) {}

  async enqueue(payload: TPayload): Promise<void> {
    await this.queue.add(this.queue.name, payload);
  }
}

const jobIdFor = (auditId: string): string => `audit-${auditId}`;

export class BullMqAuditQueue implements AuditJobQueue {
  constructor(private readonly queue: PayloadQueue<AuditJob>) {}

  async enqueueOnce(job: AuditJob, options?: EnqueueOptions): Promise<void> {
    await this.queue.add(this.queue.name, job, {
      jobId: jobIdFor(job.auditId),
      ...(options === undefined ? {} : {delay: options.delayMs}),
    });
  }

  async has(auditId: string): Promise<boolean> {
    return (await this.queue.getJob(jobIdFor(auditId))) !== undefined;
  }

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
    if (job === undefined) {
      return false;
    }

    return BullMqAuditQueue.PENDING_STATES.has(await job.getState());
  }

  async backlogCount(): Promise<number> {
    return await this.queue.getJobCountByTypes('waiting');
  }
}
