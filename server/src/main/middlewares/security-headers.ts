import type { NextFunction, Request, Response } from 'express'

/**
 * This API answers JSON and nothing else, so content sniffing has no upside
 * here and one clear downside: several fields are echoed back from user input
 * - the audited url, an audit's error text - and a sniffed response is how one
 * of those gets rendered as markup by a browser that was told to guess.
 *
 * `nosniff` is set for every response rather than beside `res.type('json')`,
 * because the responses that most need it are the ones no controller produced:
 * a body-parser failure or an unmatched route never reaches the route adapter.
 */
export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.set('x-content-type-options', 'nosniff')
  next()
}
