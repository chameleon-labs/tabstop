import type { RevokeSession } from '../../../domain/usecases/revoke-session.js'
import { noContent, serverError } from '../../helpers/http/http-helper.js'
import { clearSessionCookie } from '../../helpers/session-cookie.js'
import type { Controller } from '../../protocols/controller.js'
import type { HttpResponse } from '../../protocols/http.js'

export type LogoutRequest = {
  cookies: Record<string, string>
}

/**
 * Deliberately not behind the auth middleware. Logout is idempotent: no cookie,
 * an expired session, or an unknown id all return 204 and clear the cookie. It
 * never reports whether the session existed.
 */
export class LogoutController implements Controller<LogoutRequest> {
  constructor (
    private readonly revokeSession: RevokeSession,
    private readonly sessionCookieName: string
  ) {}

  async handle (request: LogoutRequest): Promise<HttpResponse> {
    try {
      const sessionId = request.cookies[this.sessionCookieName]
      if (sessionId !== undefined && sessionId !== '') {
        await this.revokeSession.revoke(sessionId)
      }

      return noContent(clearSessionCookie(this.sessionCookieName))
    } catch (error) {
      return serverError(error as Error)
    }
  }
}
