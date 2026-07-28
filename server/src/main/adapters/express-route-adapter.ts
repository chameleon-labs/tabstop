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

/**
 * The only response headers a controller may set. Anything else belongs to the
 * middleware stack or to this adapter, both of which a controller must not be
 * able to reach past.
 */
const CONTROLLER_HEADERS = new Set(['cache-control', 'vary'])

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
    // Within the client-supplied half the order is body, then query, then
    // params - weakest claim to strongest. A path segment is what the route
    // actually matched and what a cache keys on, so it must not be reachable
    // from a query string: with query last, `GET /api/audits/<uuid>?uuid=<other>`
    // is answered from <other> while the url still says <uuid>.
    //
    // Logout needs the cookie without sitting behind the auth middleware, so
    // that it stays idempotent (204 on an absent or dead session) rather than
    // answering 401.
    const httpRequest = {
      ...req.body,
      ...req.query,
      ...req.params,
      cookies: parseCookies(req.headers.cookie),
      ...res.locals
    }

    const httpResponse = await controller.handle(httpRequest)

    applyCookies(res, httpResponse.cookies)

    // After the middleware stack, so a controller opting into caching wins
    // over the global no-store rather than being silently overridden by it.
    //
    // Allowlisted, because forwarding arbitrary names would undo the boundary
    // this adapter exists to hold: a controller could emit its own set-cookie
    // without the security attributes below, or rewrite the CORS headers the
    // middleware just set. Caching is the only thing a controller legitimately
    // owns here.
    for (const [name, value] of Object.entries(httpResponse.headers ?? {})) {
      if (!CONTROLLER_HEADERS.has(name.toLowerCase())) continue
      res.set(name, value)
    }

    res.status(httpResponse.statusCode).json(httpResponse.body)
  }
}
