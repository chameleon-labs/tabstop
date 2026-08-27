import type {NextFunction, Request, Response} from 'express';
import type {Middleware} from '../../presentation/protocols/middleware.js';
import {parseCookies} from './cookies.js';
import {applyCookies} from './express-route-adapter.js';

export const adaptMiddleware =
  (middleware: Middleware) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const httpResponse = await middleware.handle({
      cookies: parseCookies(req.headers.cookie),
    });

    if (httpResponse.statusCode === 200) {
      Object.assign(res.locals, httpResponse.body);
      next();
      return;
    }

    applyCookies(res, httpResponse.cookies);
    res.status(httpResponse.statusCode).json(httpResponse.body);
  };
