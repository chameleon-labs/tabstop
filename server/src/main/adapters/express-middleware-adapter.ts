import type { NextFunction, Request, Response } from 'express'
import type { Middleware } from '../../presentation/protocols/middleware.js'
import { parseCookies } from './cookies.js'
import { applyCookies } from './express-route-adapter.js'

/**
 * Adapts a presentation-layer middleware the same way adaptRoute adapts a
 * controller: the middleware returns an HttpResponse and never touches Express.
 *
 * On success its body is merged into res.locals, which adaptRoute then merges
 * into the controller's request - last, so it outranks client input.
 */
export const adaptMiddleware = (middleware: Middleware) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const httpResponse = await middleware.handle({
      cookies: parseCookies(req.headers.cookie)
    })

    if (httpResponse.statusCode === 200) {
      Object.assign(res.locals, httpResponse.body)
      next()
      return
    }

    applyCookies(res, httpResponse.cookies)
    res.status(httpResponse.statusCode).json(httpResponse.body)
  }
}
