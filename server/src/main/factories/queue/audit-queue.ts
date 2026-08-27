import type {AuditJob} from '../../../data/protocols/queue/audit-job-queue.js';
import {BullMqAuditQueue} from '../../../infra/queue/bullmq-job-queue.js';
import {makeQueue} from '../../../infra/queue/helpers/bullmq-helper.js';
import {env} from '../../config/env.js';
import {QUEUE_NAMES} from '../../config/queue-names.js';

let auditQueue: BullMqAuditQueue | null = null;

export const getAuditQueue = (): BullMqAuditQueue => {
  if (auditQueue === null) {
    const queue = makeQueue<AuditJob>(QUEUE_NAMES.audit, env.redisUrl);

    queue.on('error', (error) => {
      console.error('Audit queue error (Redis connection):', error);
    });

    auditQueue = new BullMqAuditQueue(queue);
  }
  return auditQueue;
};
