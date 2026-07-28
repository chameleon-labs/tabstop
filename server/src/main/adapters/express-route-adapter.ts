import type { CookieOptions, Request, Response } from 'express'
import type { Controller } from '../../presentation/protocols/controller.js'
import type { CookieDirective } from '../../presentation/protocols/http.js'
import { env } from '../config/env.js'
import { parseCookies } from './cookies.js'

/**
 * Security attributes live here, not in the directive a controller returns, so
 * a controller cannot weaken them and there is one place to audit.
 *
 * No `domain`: the cookie stays host-only to the API, so a compromised sibling
 * subdomain never receives it. sameSite 'lax' requires the frontend and API to
 * share a registrable domain - see the deploy prerequisite recorded on #16.
 */
const SESSION_COOKIE_ATTRIBUTES: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.sessionCookieSecure,
  path: '/'
}

export const applyCookies = (res: Response, cookies: CookieDirective[] | undefined): void => {
  for (const cookie of cookies ?? []) {
    if (cookie.action === 'set') {
      res.cookie(cookie.name, cookie.value, {
        ...SESSION_COOKIE_ATTRIBUTES,
        expires: cookie.expiresAt
      })
    } else {
      res.clearCookie(cookie.name, SESSION_COOKIE_ATTRIBUTES)
    }
  }
}

export const adaptRoute = (controller: Controller) => {
  return async (req: Request, res: Response): Promise<void> => {
    // Client-supplied input first, then everything WE established - cookies we
    // parsed, then whatever the auth middleware put in res.locals. Both must
    // outrank the body: with res.locals first, a client posts {"userId": 1}
    // and impersonates. Pinned by a spec.
    //
    // Logout needs the cookie without sitting behind the auth middleware, so
    // that it stays idempotent (204 on an absent or dead session) rather than
    // answering 401.
    const httpRequest = {
      ...req.body,
      ...req.params,
      ...req.query,
      cookies: parseCookies(req.headers.cookie),
      ...res.locals
    }

    const httpResponse = await controller.handle(httpRequest)

    applyCookies(res, httpResponse.cookies)

    // After the middleware stack, so a controller opting into caching wins
    // over the global no-store rather than being silently overridden by it.
    for (const [name, value] of Object.entries(httpResponse.headers ?? {})) {
      res.set(name, value)
    }

    res.status(httpResponse.statusCode).json(httpResponse.body)
  }
}
