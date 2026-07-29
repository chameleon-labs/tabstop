import type { Router } from 'express'
import { adaptMiddleware } from '../adapters/express-middleware-adapter.js'
import { adaptRoute } from '../adapters/express-route-adapter.js'
import {
  makeAddPageController, makeDeletePageController, makeLoadPagesController,
  makeUpdatePageController
} from '../factories/controllers/page/page-controller-factories.js'
import { makeAuthMiddleware } from '../factories/middlewares/auth-middleware-factory.js'
import { makeRateLimit, ipKey } from '../middlewares/rate-limit.js'
import { makeRateLimiter } from '../factories/middlewares/rate-limit-factory.js'
import { RATE_LIMITS } from '../config/rate-limits.js'

export default (router: Router): void => {
  // One `use` for the whole prefix rather than the middleware repeated on each
  // route. Every page belongs to somebody, so there is no anonymous case here
  // to make room for - and a route added later cannot be published
  // unauthenticated by somebody forgetting a line.
  //
  // The limiters below still run per route, and deliberately BEFORE this: the
  // auth middleware looks a session up before rejecting it, so without them an
  // unauthenticated caller could drive one indexed query per request.
  router.use('/pages', adaptMiddleware(makeAuthMiddleware()))

  // The tightest bucket on this router by a distance, because an accepted add
  // is roughly thirty seconds of Chromium - the same cost the anonymous audit
  // endpoint is metered for. The ten-page cap bounds how many an account can
  // ever hold, but not how many times it can ask.
  router.post('/pages',
    makeRateLimit(
      makeRateLimiter(), [{ name: 'pageAdd', bucket: RATE_LIMITS.pageAdd, key: ipKey }]
    ),
    adaptRoute(makeAddPageController()))

  // The dashboard's only call, so it is polled rather than requested once.
  router.get('/pages',
    makeRateLimit(
      makeRateLimiter(), [{ name: 'pageRead', bucket: RATE_LIMITS.pageRead, key: ipKey }]
    ),
    adaptRoute(makeLoadPagesController()))

  router.patch('/pages/:id',
    makeRateLimit(
      makeRateLimiter(), [{ name: 'pageUpdate', bucket: RATE_LIMITS.pageUpdate, key: ipKey }]
    ),
    adaptRoute(makeUpdatePageController()))

  // Cascades to the page's audits, their violations and their alert events, so
  // every public share link for that history stops resolving. #20 owns saying
  // so before the confirmation.
  router.delete('/pages/:id',
    makeRateLimit(
      makeRateLimiter(), [{ name: 'pageDelete', bucket: RATE_LIMITS.pageDelete, key: ipKey }]
    ),
    adaptRoute(makeDeletePageController()))
}
