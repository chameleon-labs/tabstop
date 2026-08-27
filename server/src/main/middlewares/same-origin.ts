import type {NextFunction, Request, Response} from 'express';
import {env} from '../config/env.js';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const sameOrigin = (req: Request, res: Response, next: NextFunction): void => {
  if (!STATE_CHANGING_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (origin === undefined || origin === env.frontendOrigin || origin === env.publicApiOrigin) {
    next();
    return;
  }

  res.status(403).json({error: 'Cross-origin request rejected'});
};
