import type {RequestHandler, Router} from 'express';
import {adaptMiddleware} from '../adapters/express-middleware-adapter.js';
import {adaptRoute} from '../adapters/express-route-adapter.js';
import {makeRequestPageAuditController} from '../factories/controllers/audit/audit-controller-factories.js';
import {
  makeAddPageController,
  makeDeletePageController,
  makeLoadPageHistoryController,
  makeLoadPagesController,
  makeUpdatePageController,
} from '../factories/controllers/page/page-controller-factories.js';
import {makeAuthMiddleware} from '../factories/middlewares/auth-middleware-factory.js';
import {makeRateLimit, ipKey, type RateLimitRule} from '../middlewares/rate-limit.js';
import {RATE_LIMITS} from '../config/rate-limits.js';
import type {Controller} from '../../presentation/protocols/controller.js';
import type {RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';
import type {AuditJobQueue} from '../../data/protocols/queue/audit-job-queue.js';

const guarded = <TRequest>(
  rateLimiter: RateLimiter,
  rule: RateLimitRule,
  controller: Controller<TRequest>,
): RequestHandler[] => [
  makeRateLimit(rateLimiter, [rule]),
  adaptMiddleware(makeAuthMiddleware()),
  adaptRoute(controller),
];

export const setupPageRoutes = (router: Router, rateLimiter: RateLimiter, auditQueue: AuditJobQueue): void => {
  router.post(
    '/pages',
    ...guarded(
      rateLimiter,
      {name: 'pageAdd', bucket: RATE_LIMITS.pageAdd, key: ipKey},
      makeAddPageController(auditQueue),
    ),
  );

  router.get(
    '/pages',
    ...guarded(rateLimiter, {name: 'pageRead', bucket: RATE_LIMITS.pageRead, key: ipKey}, makeLoadPagesController()),
  );

  router.get(
    '/pages/:id/history',
    ...guarded(
      rateLimiter,
      {name: 'pageHistory', bucket: RATE_LIMITS.pageHistory, key: ipKey},
      makeLoadPageHistoryController(),
    ),
  );

  router.post(
    '/pages/:id/audits',
    ...guarded(
      rateLimiter,
      {name: 'pageAudit', bucket: RATE_LIMITS.pageAudit, key: ipKey},
      makeRequestPageAuditController(auditQueue),
    ),
  );

  router.patch(
    '/pages/:id',
    ...guarded(
      rateLimiter,
      {name: 'pageUpdate', bucket: RATE_LIMITS.pageUpdate, key: ipKey},
      makeUpdatePageController(),
    ),
  );

  router.delete(
    '/pages/:id',
    ...guarded(
      rateLimiter,
      {name: 'pageDelete', bucket: RATE_LIMITS.pageDelete, key: ipKey},
      makeDeletePageController(),
    ),
  );
};
