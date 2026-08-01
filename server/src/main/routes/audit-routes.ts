import type { Router } from 'express'
import { adaptRoute } from '../adapters/express-route-adapter.js'
import {
  makeLoadAuditResultController, makeRequestAuditController
} from '../factories/controllers/audit/audit-controller-factories.js'
import { makeRateLimit, ipKey } from '../middlewares/rate-limit.js'
import { RATE_LIMITS } from '../config/rate-limits.js'
import type { RateLimiter } from '../../data/protocols/rate-limit/rate-limiter.js'
import type { AuditJobQueue } from '../../data/protocols/queue/audit-job-queue.js'

export default (router: Router, rateLimiter: RateLimiter, auditQueue: AuditJobQueue): void => {
  // Anonymous by design - a one-off audit with no signup is the product's
  // hook - and each accepted request is roughly thirty seconds of Chromium.
  // The per-IP bucket is what makes that affordable.
  router.post('/audits',
    makeRateLimit(rateLimiter, [{ name: 'audit', bucket: RATE_LIMITS.audit, key: ipKey }]),
    adaptRoute(makeRequestAuditController(auditQueue)))

  // Fully public, gated only by an unguessable uuid. The payload is built by
  // an explicit mapper so nothing user-identifying can ride along.
  router.get('/audits/:uuid',
    makeRateLimit(
      rateLimiter, [{ name: 'auditRead', bucket: RATE_LIMITS.auditRead, key: ipKey }]
    ),
    adaptRoute(makeLoadAuditResultController()))
}
