import type {AuditJob} from '../../../data/protocols/queue/audit-job-queue.js';
import {BullMqAuditQueue} from '../../../infra/queue/bullmq-job-queue.js';
import {makeQueue} from '../../../infra/queue/helpers/bullmq-helper.js';
import {env} from '../../config/env.js';
import {QUEUE_NAMES} from '../../config/queue-names.js';

/**
 * One queue for the process, shared by every usecase that enqueues an audit.
 *
 * A Queue holds a Redis connection, so building one per usecase - let alone
 * per request - would open a connection per usecase, for the same reason the
 * auditor owns a single browser rather than launching one per job. It moved
 * out of the audit factories the moment adding a page became a second caller.
 */
let auditQueue: BullMqAuditQueue | null = null;

export const getAuditQueue = (): BullMqAuditQueue => {
  if (auditQueue === null) {
    const queue = makeQueue<AuditJob>(QUEUE_NAMES.audit, env.redisUrl);

    // A Queue emits 'error' when its Redis connection fails. Without a
    // listener those go unreported, and an EventEmitter with no 'error'
    // handler is a hazard the API process should not carry - the intended
    // answer to a queue outage is a 503, not a surprise.
    queue.on('error', (error) => {
      console.error('Audit queue error (Redis connection):', error);
    });

    auditQueue = new BullMqAuditQueue(queue);
  }
  return auditQueue;
};
