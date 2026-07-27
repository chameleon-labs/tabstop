import { env } from './env.js'

/**
 * `__Host-` is refused by browsers unless the cookie is Secure, Path=/ and has
 * no Domain attribute - exactly the attributes the route adapter already sets.
 * That refusal is the point: it makes the name unusable by any other host, so a
 * sibling subdomain cannot set `Domain=.example.com` and overwrite the session
 * the API reads. Without it, the deploy topology this design requires (app and
 * api under one registrable domain) hands anyone who controls a sibling host a
 * session-takeover primitive - and a session the victim cannot even log out of,
 * since logout would revoke the attacker's id instead of their own.
 *
 * The prefix is invalid without Secure, so plain-http local development falls
 * back to the bare name - where no sibling host exists to exploit it.
 */
export const sessionCookieName = (secure: boolean): string => secure ? '__Host-sid' : 'sid'

export const SESSION_COOKIE_NAME = sessionCookieName(env.sessionCookieSecure)
