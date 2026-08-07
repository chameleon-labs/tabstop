import type {PayloadQueue} from '../../infra/queue/helpers/bullmq-helper.js';
import {ALERT_DISPATCH_CRON, ALERT_DISPATCH_SCHEDULER_ID, ALERT_DISPATCH_TIMEZONE} from '../config/alert-email.js';
import type {AlertQueuePayload} from '../config/queue-names.js';

export const registerAlertEmailDispatcher = async (queue: PayloadQueue<AlertQueuePayload>): Promise<void> => {
  await queue.upsertJobScheduler(
    ALERT_DISPATCH_SCHEDULER_ID,
    {pattern: ALERT_DISPATCH_CRON, tz: ALERT_DISPATCH_TIMEZONE},
    {
      name: 'dispatch',
      data: {kind: 'dispatch'},
      opts: {attempts: 3, backoff: {type: 'exponential', delay: 1000}},
    },
  );
};
