import type { AuthenticatedSession } from '../../domain/models/session.js'
import type { CookieDirective } from '../protocols/http.js'

export const SESSION_COOKIE_NAME = 'sid'

/**
 * expiresAt comes from the persisted session, not from a duration recomputed
 * here, so the cookie and the row can never disagree about when it dies.
 */
export const setSessionCookie = (session: AuthenticatedSession): CookieDirective[] => [
  {
    action: 'set',
    name: SESSION_COOKIE_NAME,
    value: session.sessionId,
    expiresAt: session.expiresAt
  }
]

export const clearSessionCookie = (): CookieDirective[] => [
  { action: 'clear', name: SESSION_COOKIE_NAME }
]
