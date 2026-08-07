import type {NextFunction, Request, Response} from 'express';

/**
 * Responses declare their type explicitly (JSON by default, HTML only for the
 * two unsubscribe confirmation pages), so content sniffing has no upside and
 * one clear downside: several JSON fields echo user input, and a sniffed
 * response is how one of those gets rendered as markup by a browser told to
 * guess.
 *
 * `nosniff` is set for every response rather than beside `res.type('json')`,
 * because the responses that most need it are the ones no controller produced:
 * a body-parser failure or an unmatched route never reaches the route adapter.
 */
export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.set('x-content-type-options', 'nosniff');
  next();
};
