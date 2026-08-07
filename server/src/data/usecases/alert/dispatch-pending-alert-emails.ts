import type {
  AlertDispatchMode,
  LoadPendingAlertEventsRepository,
} from '../../protocols/db/alert-event/load-pending-alert-events-repository.js';
import type {AlertEmailJobQueue} from '../../protocols/queue/alert-email-job-queue.js';
import type {
  AlertEmailDispatchSummary,
  DispatchPendingAlertEmails,
} from '../../../domain/usecases/dispatch-pending-alert-emails.js';

const DEFAULT_BATCH_SIZE = 100;

export class DbDispatchPendingAlertEmails implements DispatchPendingAlertEmails {
  constructor(
    private readonly alerts: LoadPendingAlertEventsRepository,
    private readonly queue: AlertEmailJobQueue,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
    private readonly mode: AlertDispatchMode = 'delivery',
  ) {}

  async dispatch(): Promise<AlertEmailDispatchSummary> {
    let afterId: string | null = null;
    let processed = 0;

    for (;;) {
      const ids = await this.alerts.loadPendingAlertEventIds(afterId, this.batchSize, this.mode);
      if (ids.length === 0) {
        break;
      }

      for (const alertEventId of ids) {
        await this.queue.enqueueOnce({alertEventId});
        processed += 1;
      }

      afterId = ids[ids.length - 1] ?? null;
      if (ids.length < this.batchSize) {
        break;
      }
    }

    return {processed};
  }
}
