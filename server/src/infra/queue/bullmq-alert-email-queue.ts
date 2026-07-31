import type {
  AlertEmailJob, AlertEmailJobQueue
} from '../../data/protocols/queue/alert-email-job-queue.js'
import type { AlertQueuePayload } from '../../main/config/queue-names.js'
import type { PayloadQueue } from './helpers/bullmq-helper.js'

const jobIdFor = (alertEventId: string): string => `alert-email-${alertEventId}`

export class BullMqAlertEmailQueue implements AlertEmailJobQueue {
  constructor (
    private readonly queue: PayloadQueue<AlertQueuePayload>,
    /**
     * A console preview completes its BullMQ job while deliberately leaving
     * emailed_at null. When a deployment later enables a real provider, that
     * retained completed record must be reprocessed immediately rather than
     * blocking the database event until lazy retention removes it.
     */
    private readonly reviveCompleted = false
  ) {}

  async enqueueOnce (job: AlertEmailJob): Promise<void> {
    const jobId = jobIdFor(job.alertEventId)
    const existing = await this.queue.getJob(jobId)
    if (existing !== undefined) {
      // Failed records are retained for a day (and cleaned lazily). A plain
      // add with the same id is treated as a duplicate and leaves that record
      // failed, so the database outbox would keep finding work Redis refused
      // to run. Reprocess the same job and restore its full retry allowance.
      const state = await existing.getState()
      if (state === 'failed') {
        await existing.retry('failed', {
          resetAttemptsMade: true,
          resetAttemptsStarted: true
        })
      } else if (state === 'completed' && this.reviveCompleted) {
        await existing.retry('completed', {
          resetAttemptsMade: true,
          resetAttemptsStarted: true
        })
      }
      return
    }

    await this.queue.add('send', {
      kind: 'send',
      alertEventId: job.alertEventId
    }, {
      jobId
    })
  }
}
