import type {AlertEmailJob, AlertEmailJobQueue} from '../../data/protocols/queue/alert-email-job-queue.js';
import type {AlertQueuePayload} from '../../main/config/queue-names.js';
import type {PayloadQueue} from './helpers/bullmq-helper.js';

const jobIdFor = (alertEventId: string): string => `alert-email-${alertEventId}`;

export class BullMqAlertEmailQueue implements AlertEmailJobQueue {
  constructor(
    private readonly queue: PayloadQueue<AlertQueuePayload>,
    private readonly reviveCompleted = false,
  ) {}

  async enqueueOnce(job: AlertEmailJob): Promise<void> {
    const jobId = jobIdFor(job.alertEventId);
    const existing = await this.queue.getJob(jobId);
    if (existing !== undefined) {
      const state = await existing.getState();
      if (state === 'failed') {
        await existing.retry('failed', {
          resetAttemptsMade: true,
          resetAttemptsStarted: true,
        });
      } else if (state === 'completed' && this.reviveCompleted) {
        await existing.retry('completed', {
          resetAttemptsMade: true,
          resetAttemptsStarted: true,
        });
      }
      return;
    }

    await this.queue.add(
      'send',
      {
        kind: 'send',
        alertEventId: job.alertEventId,
      },
      {
        jobId,
      },
    );
  }
}
