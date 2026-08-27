import type {Router} from 'express';
import {adaptMiddleware} from '../adapters/express-middleware-adapter.js';
import {adaptRoute} from '../adapters/express-route-adapter.js';
import {
  makeLoginController,
  makeLogoutController,
  makeMeController,
  makeSignupController,
} from '../factories/controllers/account/account-controller-factories.js';
import {makeAuthMiddleware} from '../factories/middlewares/auth-middleware-factory.js';
import {makeRateLimit, emailKey, ipKey} from '../middlewares/rate-limit.js';
import {RATE_LIMITS} from '../config/rate-limits.js';
import type {RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';

export const setupAccountRoutes = (router: Router, rateLimiter: RateLimiter): void => {
  router.post(
    '/signup',
    makeRateLimit(rateLimiter, [{name: 'signup', bucket: RATE_LIMITS.signup, key: ipKey}]),
    adaptRoute(makeSignupController()),
  );

  router.post(
    '/login',
    makeRateLimit(rateLimiter, [
      {name: 'login', bucket: RATE_LIMITS.login, key: ipKey},
      {name: 'loginEmail', bucket: RATE_LIMITS.loginEmail, key: emailKey},
    ]),
    adaptRoute(makeLoginController()),
  );

  router.post(
    '/logout',
    makeRateLimit(rateLimiter, [{name: 'logout', bucket: RATE_LIMITS.logout, key: ipKey}]),
    adaptRoute(makeLogoutController()),
  );

  router.get(
    '/me',
    makeRateLimit(rateLimiter, [{name: 'me', bucket: RATE_LIMITS.me, key: ipKey}]),
    adaptMiddleware(makeAuthMiddleware()),
    adaptRoute(makeMeController()),
  );
};
