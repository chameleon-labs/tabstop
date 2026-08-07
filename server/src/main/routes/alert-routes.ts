import type {Router} from 'express';
import {adaptRoute} from '../adapters/express-route-adapter.js';
import {RATE_LIMITS} from '../config/rate-limits.js';
import {
  makeAlertUnsubscribeConfirmationController,
  makeUnsubscribePageAlertsController,
} from '../factories/controllers/alert/alert-controller-factories.js';
import {ipKey, makeRateLimit} from '../middlewares/rate-limit.js';
import type {RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';

export const setupAlertRoutes = (router: Router, rateLimiter: RateLimiter): void => {
  // Public by design: the HMAC token is the authority. Requiring a session
  // would make both the email link and RFC 8058 one-click unsubscribe fail.
  router.get(
    '/alerts/unsubscribe/:token',
    makeRateLimit(rateLimiter, [
      {
        name: 'alertUnsubscribeRead',
        bucket: RATE_LIMITS.alertUnsubscribeRead,
        key: ipKey,
      },
    ]),
    adaptRoute(makeAlertUnsubscribeConfirmationController()),
  );

  router.post(
    '/alerts/unsubscribe/:token',
    makeRateLimit(rateLimiter, [
      {
        name: 'alertUnsubscribe',
        bucket: RATE_LIMITS.alertUnsubscribe,
        key: ipKey,
      },
    ]),
    adaptRoute(makeUnsubscribePageAlertsController()),
  );
};
