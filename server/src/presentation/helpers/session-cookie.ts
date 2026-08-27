import type {AuthenticatedSession} from '../../domain/models/session.js';
import type {CookieDirective} from '../protocols/http.js';

export const setSessionCookie = (name: string, session: AuthenticatedSession): CookieDirective[] => [
  {
    action: 'set',
    name,
    value: session.sessionId,
    expiresAt: session.expiresAt,
  },
];

export const clearSessionCookie = (name: string): CookieDirective[] => [{action: 'clear', name}];
