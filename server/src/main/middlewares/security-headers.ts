import type {NextFunction, Request, Response} from 'express';

export const securityHeaders = (_req: Request, res: Response, next: NextFunction): void => {
  res.set('x-content-type-options', 'nosniff');
  next();
};
