import type {AuthenticatedSession} from '../../domain/models/session.js';
import type {CookieDirective} from '../protocols/http.js';

/**
 * The cookie's NAME is injected rather than fixed here, because the name is a
 * security control: `__Host-` is a prefix browsers refuse to accept unless the
 * cookie is Secure, Path=/ and carries no Domain. That is what stops a sibling
 * subdomain setting its own `sid` with `Domain=.example.com` and silently
 * replacing the victim's session ("cookie tossing"). The prefix cannot be used
 * over plain http, so the composition root picks the name per environment.
 */
export const setSessionCookie = (name: string, session: AuthenticatedSession): CookieDirective[] => [
  {
    action: 'set',
    name,
    value: session.sessionId,
    // Taken from the persisted session, not a duration recomputed here, so the
    // cookie and the row cannot disagree about when it dies.
    expiresAt: session.expiresAt,
  },
];

export const clearSessionCookie = (name: string): CookieDirective[] => [{action: 'clear', name}];
