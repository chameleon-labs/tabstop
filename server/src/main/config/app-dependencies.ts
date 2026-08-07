import type {RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';
import type {AuditJobQueue} from '../../data/protocols/queue/audit-job-queue.js';
import {makeRateLimiter} from '../factories/middlewares/rate-limit-factory.js';
import {getAuditQueue} from '../factories/queue/audit-queue.js';

export type AppDependencies = {
  rateLimiter: RateLimiter;
  auditQueue: AuditJobQueue;
};

export const makeProductionDependencies = (): AppDependencies => ({
  rateLimiter: makeRateLimiter(),
  auditQueue: getAuditQueue(),
});
