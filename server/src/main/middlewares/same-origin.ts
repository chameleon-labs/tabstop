import type {NextFunction, Request, Response} from 'express';
import {env} from '../config/env.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF protection for state-changing requests.
 *
 * `SameSite=Lax` blocks a cross-SITE form POST, but this design deliberately
 * puts the app and the API under one registrable domain - so a page on any
 * sibling host is same-site, and its form POST carries the session cookie with
 * CORS unable to prevent it (CORS governs reading responses, not sending
 * requests). Today that means forced logout; once #11 adds DELETE /api/pages it
 * would mean destroying someone's data.
 *
 * An absent Origin is allowed: browsers always send it on state-changing
 * requests, so a missing one cannot be the CSRF vector - it is a non-browser
 * caller such as curl, a server-to-server request, or the test suite.
 */
export const sameOrigin = (req: Request, res: Response, next: NextFunction): void => {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  // The API also serves the unsubscribe confirmation form. Its browser POST
  // carries PUBLIC_API_ORIGIN, not FRONTEND_ORIGIN; both are application
  // origins under our control and neither admits a sibling subdomain.
  if (origin === undefined || origin === env.frontendOrigin || origin === env.publicApiOrigin) {
    next();
    return;
  }

  res.status(403).json({error: 'Cross-origin request rejected'});
};
