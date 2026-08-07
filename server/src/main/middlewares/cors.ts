import type {NextFunction, Request, Response} from 'express';
import {env} from '../config/env.js';

/**
 * Credentialed CORS. `*` is not a wildcard on a credentialed request - not for
 * the origin, and not for the allowed headers either - so both are stated
 * exactly. Vary: origin keeps a cache from serving one origin's response to
 * another.
 */
export const cors = (req: Request, res: Response, next: NextFunction): void => {
  res.set('access-control-allow-origin', env.frontendOrigin);
  res.set('access-control-allow-credentials', 'true');
  // append, not set: overwriting would silently drop a Vary added elsewhere.
  res.append('vary', 'origin');
  res.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE');
  res.set('access-control-allow-headers', 'content-type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
};
