import type {RequestHandler, Router} from 'express';
import {adaptMiddleware} from '../adapters/express-middleware-adapter.js';
import {adaptRoute} from '../adapters/express-route-adapter.js';
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

/**
 * Limit, then authenticate, then handle - as one unit, because the order is
 * load-bearing and the middle step is easy to leave out.
 *
 * The order first. The auth middleware looks a session up before rejecting it,
 * so the limiter has to run BEFORE it or an unauthenticated caller can drive
 * one indexed query per request, unbounded. `/me` is wired this way for
 * exactly that reason. The tempting shorthand - `router.use('/pages', auth)`
 * above the routes, with a limiter on each - reads as if it does the same
 * thing and does the opposite: Express runs layers in registration order, so
 * the prefix `use` runs first and every page bucket sits behind the lookup it
 * was meant to protect. That is what this file did until #47 review caught it.
 *
 * And the middle step. Every page belongs to somebody, so there is no
 * anonymous case here to make room for - which means a route reaching
 * `adaptRoute` without authentication is always a bug, never a choice. Putting
 * auth inside this helper is what keeps that from depending on whoever adds
 * the fifth route remembering a line.
 */
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
  // The tightest bucket here by a distance, because an accepted add is roughly
  // thirty seconds of Chromium - the same cost the anonymous audit endpoint is
  // metered for. The ten-page cap bounds how many pages an account can HOLD,
  // not how many times it can ask.
  router.post(
    '/pages',
    ...guarded(
      rateLimiter,
      {name: 'pageAdd', bucket: RATE_LIMITS.pageAdd, key: ipKey},
      makeAddPageController(auditQueue),
    ),
  );

  // The dashboard's only call, so it is polled rather than requested once.
  router.get(
    '/pages',
    ...guarded(rateLimiter, {name: 'pageRead', bucket: RATE_LIMITS.pageRead, key: ipKey}, makeLoadPagesController()),
  );

  // The trend chart's data (#21). Registered before the parameterless routes'
  // siblings only by convention - Express matches on the full path, so
  // `/pages/:id/history` and `/pages/:id` cannot shadow each other.
  router.get(
    '/pages/:id/history',
    ...guarded(
      rateLimiter,
      {name: 'pageHistory', bucket: RATE_LIMITS.pageHistory, key: ipKey},
      makeLoadPageHistoryController(),
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

  // Cascades to the page's audits, their violations and their alert events, so
  // every public share link for that history stops resolving. #20 owns saying
  // so before the confirmation.
  router.delete(
    '/pages/:id',
    ...guarded(
      rateLimiter,
      {name: 'pageDelete', bucket: RATE_LIMITS.pageDelete, key: ipKey},
      makeDeletePageController(),
    ),
  );
};
