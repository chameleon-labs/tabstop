import type {NextFunction, Request, Response} from 'express';
import {env} from '../config/env.js';

export const cors = (req: Request, res: Response, next: NextFunction): void => {
  res.set('access-control-allow-origin', env.frontendOrigin);
  res.set('access-control-allow-credentials', 'true');
  res.append('vary', 'origin');
  res.set('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE');
  res.set('access-control-allow-headers', 'content-type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
};
