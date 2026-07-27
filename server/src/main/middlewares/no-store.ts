import type { NextFunction, Request, Response } from 'express'

/**
 * Nothing this API returns is safe for a shared cache to reuse. `GET /api/me`
 * is the sharp case: a 200 with no Cache-Control is heuristically cacheable,
 * and the only thing the response varies by that a cache can see is the
 * session cookie - so a CDN in front of the API (which #16 will introduce)
 * could serve one user's identity to another.
 */
export const noStore = (_req: Request, res: Response, next: NextFunction): void => {
  res.set('cache-control', 'no-store')
  next()
}
