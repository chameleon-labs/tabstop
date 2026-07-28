import type { Router } from 'express'
import { adaptMiddleware } from '../adapters/express-middleware-adapter.js'
import { adaptRoute } from '../adapters/express-route-adapter.js'
import {
  makeLoginController, makeLogoutController, makeMeController, makeSignupController
} from '../factories/controllers/account/account-controller-factories.js'
import { makeAuthMiddleware } from '../factories/middlewares/auth-middleware-factory.js'
import { makeRateLimit, emailKey, ipKey } from '../middlewares/rate-limit.js'
import { makeRateLimiter } from '../factories/middlewares/rate-limit-factory.js'
import { RATE_LIMITS } from '../config/rate-limits.js'

export default (router: Router): void => {
  router.post('/signup',
    makeRateLimit(makeRateLimiter(), [{ name: 'signup', bucket: RATE_LIMITS.signup, key: ipKey }]),
    adaptRoute(makeSignupController()))

  // Two buckets. Per-IP alone misses credential stuffing - one password
  // sprayed across many accounts from many addresses - and per-email alone
  // lets one address walk a list. Both run before the controller, so neither
  // can become an early return that skips the dummy scrypt verify.
  router.post('/login',
    makeRateLimit(makeRateLimiter(), [
      { name: 'login', bucket: RATE_LIMITS.login, key: ipKey },
      { name: 'loginEmail', bucket: RATE_LIMITS.loginEmail, key: emailKey }
    ]),
    adaptRoute(makeLoginController()))

  // Deliberately unlimited: logout must stay idempotent, and nothing
  // accumulates from repeating it.
  // Not behind the auth middleware: logout stays idempotent rather than 401.
  router.post('/logout', adaptRoute(makeLogoutController()))

  // The limiter runs BEFORE the auth middleware, which looks a session up
  // before rejecting it - so an unauthenticated caller could otherwise force
  // one indexed query per request.
  router.get('/me',
    makeRateLimit(makeRateLimiter(), [{ name: 'me', bucket: RATE_LIMITS.me, key: ipKey }]),
    adaptMiddleware(makeAuthMiddleware()),
    adaptRoute(makeMeController()))
}
