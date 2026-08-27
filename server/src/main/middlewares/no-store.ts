import type {NextFunction, Request, Response} from 'express';

export const noStore = (_req: Request, res: Response, next: NextFunction): void => {
  res.set('cache-control', 'no-store');
  next();
};
