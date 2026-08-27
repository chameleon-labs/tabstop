import {env} from './env.js';

export const sessionCookieName = (secure: boolean): string => (secure ? '__Host-sid' : 'sid');

export const SESSION_COOKIE_NAME = sessionCookieName(env.sessionCookieSecure);
