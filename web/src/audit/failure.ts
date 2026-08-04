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

/**
 * Which request failed, so a retry re-runs the right one.
 *
 * `request` is the POST being refused - retrying means asking for a NEW audit.
 * `poll` is the GET failing while an accepted audit is already running -
 * retrying means asking again about the audit that exists. Creating a second
 * audit there would spend another thirty seconds of Chromium, and another of
 * the caller's rate limit, to answer a question already being answered.
 */
export type FailureSource = 'request' | 'poll' | 'audit'

export type DescribedFailure = {
  message: string
  action: FailureAction
  source: FailureSource
  /** Present only for `signup`, so a countdown can be rendered. */
  rateLimit?: RateLimitedBody
}

const GENERIC = 'Something went wrong'

/**
 * The two sentences this module writes, and the only ones.
 *
 * A rejected `fetch` never reached the server, so there is no server sentence
 * to quote - which makes these ours by necessity rather than by choice, exactly
 * like the two in `url.ts`. "Something went wrong" was strictly less than what
 * is known: the request did not arrive, and that is a different problem from an
 * audit that failed, with a different thing to check.
 *
 * They differ because the reader's situation differs. Failing to START an audit
 * is a fresh action they can repeat; losing contact DURING one leaves an audit
 * that is probably still running on the server.
 */
const UNREACHABLE_REQUEST = 'Could not reach tabstop. Check your connection and try again'
const UNREACHABLE_POLL = 'Lost contact with tabstop. The audit may still be running'

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
    return { message: limit.error, action: 'signup', source: 'request', rateLimit: limit }
  }

  if (!isApiError(error)) {
    // Never reached the server at all - offline, DNS, connection refused. The
    // request is worth repeating because nothing considered it, and #19 asks
    // for a distinct message per failure: this one is known to be a connection
    // problem, so saying only "something went wrong" throws that away.
    return { message: UNREACHABLE_REQUEST, action: 'retry', source: 'request' }
  }

  // 400 is #7 refusing the address: blocked scheme, port, private address,
  // embedded credentials. Every one of them is a property of the URL, so
  // retrying it is guaranteed to fail identically.
  if (error.status === 400) return { message: error.message, action: 'check-url', source: 'request' }

  // 503 is the queue at its depth cap - explicitly "please try again", and the
  // audit row was removed, so there is nothing half-created to reason about.
  if (error.status >= 500) return { message: error.message, action: 'retry', source: 'request' }

  return { message: error.message, action: 'none', source: 'request' }
}

/**
 * A failure of `GET /api/audits/:uuid` while waiting.
 *
 * Its own function rather than a reuse of the one above, because the same
 * status means something different here. A 429 on the POST is the anonymous
 * audit limit and the moment to offer an account; a 429 on the READ is polling
 * too fast for a bucket that refills in seconds, and offering a signup for it
 * would be both confusing and slightly dishonest.
 *
 * Without this the screen had no way to report a failed poll at all: the audit
 * query would exhaust its retries, `request.error` stayed null, and the
 * progress indicator spun forever on an audit nobody was still asking about.
 */
export const describePollFailure = (error: unknown): DescribedFailure => {
  if (!isApiError(error)) {
    // Same cause, different situation: an audit was accepted and is probably
    // still running on the server, so this is lost contact rather than a failed
    // start. Retrying asks again rather than starting over.
    return { message: UNREACHABLE_POLL, action: 'retry', source: 'poll' }
  }

  // The uuid names nothing. Retrying cannot conjure it, and it is the one poll
  // failure that is permanent.
  if (error.status === 404) return { message: error.message, action: 'none', source: 'poll' }

  return { message: error.message, action: 'retry', source: 'poll' }
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
  action: 'retry',
  // A fresh audit, not another poll: this one reached a terminal state and
  // asking about it again would return the same failure forever.
  source: 'audit'
})

/**
 * Whichever of the two applies, or null while nothing has gone wrong.
 *
 * A screen has two failure sources and must not have two failure renderers: the
 * request can be refused, and an accepted audit can end in `failed`. They arrive
 * at different times through different hooks and read identically to the person
 * waiting.
 */
export type FailureSources = {
  /** From `POST /api/audits`. */
  requestError: unknown
  /** From `GET /api/audits/:uuid`, after its retries are exhausted. */
  pollError: unknown
  audit: AuditResultResponse | undefined
}

/**
 * Whichever applies, or null while nothing has gone wrong.
 *
 * A screen has THREE failure sources and must not have three failure
 * renderers: the request can be refused, the poll can fail, and an accepted
 * audit can end in `failed`. They arrive at different times through different
 * hooks and read identically to the person waiting.
 *
 * Ordered newest-event-first. A request failure means a fresh submission was
 * just refused, so anything below it is the previous attempt.
 */
export const describeFailure = (
  { requestError, pollError, audit }: FailureSources
): DescribedFailure | null => {
  if (requestError !== null && requestError !== undefined) {
    return describeRequestFailure(requestError)
  }
  if (pollError !== null && pollError !== undefined) return describePollFailure(pollError)
  if (audit?.status === 'failed') return describeAuditFailure(audit)
  return null
}

/** Narrowed for a caller that wants the rate-limit branch specifically. */
export const isRateLimited = (
  failure: DescribedFailure
): failure is DescribedFailure & { rateLimit: RateLimitedBody } =>
  failure.action === 'signup' && failure.rateLimit !== undefined
