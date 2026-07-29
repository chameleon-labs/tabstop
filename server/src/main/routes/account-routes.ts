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

  // Not behind the auth middleware: logout stays idempotent rather than 401.
  //
  // It IS behind a bucket, though a deliberately loose one. Idempotence and
  // "nothing accumulates" are both true and neither is about load: every call
  // carrying a cookie is an indexed DELETE that an anonymous caller can drive
  // as fast as it can open sockets. The capacity is set so far above any
  // genuine client that signing out cannot become a thing a person fails at.
  router.post('/logout',
    makeRateLimit(makeRateLimiter(), [{ name: 'logout', bucket: RATE_LIMITS.logout, key: ipKey }]),
    adaptRoute(makeLogoutController()))

  // The limiter runs BEFORE the auth middleware, which looks a session up
  // before rejecting it - so an unauthenticated caller could otherwise force
  // one indexed query per request.
  router.get('/me',
    makeRateLimit(makeRateLimiter(), [{ name: 'me', bucket: RATE_LIMITS.me, key: ipKey }]),
    adaptMiddleware(makeAuthMiddleware()),
    adaptRoute(makeMeController()))
}
