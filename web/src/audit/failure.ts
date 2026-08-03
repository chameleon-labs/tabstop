import type { AuditResultResponse, RateLimitedBody } from '@tabstop/contract'
import { isApiError, rateLimitOf } from '../api/client'

/**
 * What to OFFER beside a failure. Not what to say - the server already said it.
 *
 * Eight distinct sentences already exist server-side, written for a person:
 * `classifyAuditError` produces seven and `REJECTION_MESSAGES` the rest. Adding
 * a ninth table here would be a second copy of a thing whose whole value is
 * that there is one, and it would drift the first time either side is reworded.
 * So the client quotes the message and decides only what a person can DO next,
 * which is a question the server has no opinion about.
 */
export type FailureAction =
  /** The same URL might work on a second attempt. */
  | 'retry'
  /** The URL itself is what is wrong; retrying it changes nothing. */
  | 'check-url'
  /** The rate limit. The most motivated signup candidate this product ever sees. */
  | 'signup'
  /** Nothing honest to offer. */
  | 'none'

export type DescribedFailure = {
  message: string
  action: FailureAction
  /** Present only for `signup`, so a countdown can be rendered. */
  rateLimit?: RateLimitedBody
}

const GENERIC = 'Something went wrong'

/**
 * A failure of `POST /api/audits`, branched on the STATUS CODE.
 *
 * Status rather than message text, and that is the point: a status is a
 * contract, a sentence is prose. Matching on prose would break silently the
 * first time someone improves the wording, and improving wording is exactly
 * what a team does to an error message.
 */
export const describeRequestFailure = (error: unknown): DescribedFailure => {
  const limit = rateLimitOf(error)
  if (limit !== null) {
    // Deliberately not framed as an error. Someone who has audited enough pages
    // to hit the anonymous limit has demonstrated the value of the product more
    // convincingly than any landing page could.
    return { message: limit.error, action: 'signup', rateLimit: limit }
  }

  if (!isApiError(error)) {
    // Never reached the server at all - offline, DNS, connection refused. The
    // request is worth repeating because nothing considered it.
    return { message: GENERIC, action: 'retry' }
  }

  // 400 is #7 refusing the address: blocked scheme, port, private address,
  // embedded credentials. Every one of them is a property of the URL, so
  // retrying it is guaranteed to fail identically.
  if (error.status === 400) return { message: error.message, action: 'check-url' }

  // 503 is the queue at its depth cap - explicitly "please try again", and the
  // audit row was removed, so there is nothing half-created to reason about.
  if (error.status === 503) return { message: error.message, action: 'retry' }

  if (error.status >= 500) return { message: error.message, action: 'retry' }

  return { message: error.message, action: 'none' }
}

/**
 * An audit that reached a terminal `failed` state.
 *
 * `retry` for everything, and it is worth being honest about why rather than
 * pretending this is a considered branch: the server DOES know which failures
 * are permanent - `classifyAuditError` returns `permanent: boolean` and uses it
 * to decide whether to spend another attempt - but that flag is dropped before
 * the wire. `AuditResultResponse` carries `error` as free text and nothing
 * machine-readable beside it.
 *
 * The alternatives are worse. Matching the server's sentences here re-creates
 * the table this file exists to avoid, and breaks on a reword. Offering nothing
 * denies a retry to the timeout and transient cases, which are the ones most
 * likely to succeed. Offering retry on a permanently blocked address costs one
 * wasted round trip and an identical message - the mildest of the three
 * failures, and the only one that cannot mislead.
 *
 * The real fix is a failure code on the response; see the issue filed against
 * this. Until then this is a deliberate over-offer, not an oversight.
 */
export const describeAuditFailure = (audit: AuditResultResponse): DescribedFailure => ({
  message: audit.error ?? GENERIC,
  action: 'retry'
})

/**
 * Whichever of the two applies, or null while nothing has gone wrong.
 *
 * A screen has two failure sources and must not have two failure renderers: the
 * request can be refused, and an accepted audit can end in `failed`. They arrive
 * at different times through different hooks and read identically to the person
 * waiting.
 */
export const describeFailure = (
  requestError: unknown, audit: AuditResultResponse | undefined
): DescribedFailure | null => {
  if (requestError !== null && requestError !== undefined) {
    return describeRequestFailure(requestError)
  }
  if (audit?.status === 'failed') return describeAuditFailure(audit)
  return null
}

/** Narrowed for a caller that wants the rate-limit branch specifically. */
export const isRateLimited = (
  failure: DescribedFailure
): failure is DescribedFailure & { rateLimit: RateLimitedBody } =>
  failure.action === 'signup' && failure.rateLimit !== undefined
