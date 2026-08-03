import type { RateLimitedBody } from '@tabstop/contract'

/**
 * The body a denied request answers with.
 *
 * A view helper rather than an inline object in the middleware, for the same
 * reason `audit-view.ts` is one: the client branches on these fields - it turns
 * `resetAt` into a countdown and `retryAfter` into a wait - so they are a
 * published contract, and the annotation here is what fails the build if the
 * two stop agreeing.
 *
 * `retryAfter` is whole seconds, because the `retry-after` header admits no
 * other unit and the two should never disagree. Never zero: that invites an
 * immediate retry, which is another denial for whoever shares the address.
 *
 * `resetAt` is absolute because a countdown is what a UI can render without
 * knowing when the response arrived - a client that subtracts elapsed time from
 * a relative number is wrong by however long the response spent in flight.
 */
export const toRateLimitedBody = (retryAfterSeconds: number, now: Date): RateLimitedBody => ({
  error: 'Too many requests',
  retryAfter: retryAfterSeconds,
  resetAt: new Date(now.getTime() + retryAfterSeconds * 1000).toISOString()
})
