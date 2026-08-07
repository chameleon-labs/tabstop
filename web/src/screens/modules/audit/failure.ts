import type {AuditResultResponse, RateLimitedBody} from '@tabstop/contract';
import {isApiError, rateLimitOf} from '@/api/client';

/**
 * What to OFFER beside a failure. Not what to say - the server already said it.
 *
 * Eight sentences written for a person already exist server-side. A ninth table
 * here would be a second copy of a thing whose value is that there is one, and
 * would drift the first time either side is reworded. So the client quotes the
 * message and decides only what a person can DO next.
 */
export type FailureAction =
  /** The same URL might work on a second attempt. */
  | 'retry'
  /** The URL itself is what is wrong; retrying it changes nothing. */
  | 'check-url'
  /** The rate limit. The most motivated signup candidate this product ever sees. */
  | 'signup'
  /** Nothing honest to offer. */
  | 'none';

/**
 * Which request failed, so a retry re-runs the right one.
 *
 * `request` retries mean asking for a NEW audit; `poll` means asking again
 * about one already running. Creating a second audit there would spend another
 * thirty seconds of Chromium answering a question already being answered.
 */
export type FailureSource = 'request' | 'poll' | 'audit';

export type DescribedFailure = {
  message: string;
  action: FailureAction;
  source: FailureSource;
  /** Present only for `signup`, so a countdown can be rendered. */
  rateLimit?: RateLimitedBody;
};

const GENERIC = 'Something went wrong';

/**
 * The two sentences this module writes, and the only ones.
 *
 * A rejected `fetch` never reached the server, so there is no sentence to
 * quote. They differ because the situation does: failing to START an audit is a
 * fresh action to repeat, while losing contact DURING one leaves an audit
 * probably still running on the server.
 */
const UNREACHABLE_REQUEST = 'Could not reach tabstop. Check your connection and try again';
const UNREACHABLE_POLL = 'Lost contact with tabstop. The audit may still be running';

/**
 * A failure of `POST /api/audits`, branched on the STATUS CODE.
 *
 * A status is a contract; a sentence is prose. Matching on prose would break
 * silently the first time someone improved the wording.
 */
export const describeRequestFailure = (error: unknown): DescribedFailure => {
  const limit = rateLimitOf(error);
  if (limit !== null) {
    // Not framed as an error: hitting the anonymous limit demonstrates the
    // product's value more convincingly than any landing page could.
    return {message: limit.error, action: 'signup', source: 'request', rateLimit: limit};
  }

  if (!isApiError(error)) {
    // Never reached the server - offline, DNS, connection refused. Worth
    // repeating because nothing considered it.
    return {message: UNREACHABLE_REQUEST, action: 'retry', source: 'request'};
  }

  // 400 is the address being refused - scheme, port, private address,
  // credentials. All properties of the URL, so a retry fails identically.
  if (error.status === 400) {
    return {message: error.message, action: 'check-url', source: 'request'};
  }

  // 503 is the queue at its depth cap, and the audit row was removed.
  if (error.status >= 500) {
    return {message: error.message, action: 'retry', source: 'request'};
  }

  return {message: error.message, action: 'none', source: 'request'};
};

/**
 * A failure of `GET /api/audits/:uuid` while waiting.
 *
 * Separate from the POST because the same status means something else here: a
 * 429 on the POST is the audit limit and the moment to offer an account; on the
 * READ it is polling too fast for a bucket that refills in seconds.
 */
export const describePollFailure = (error: unknown): DescribedFailure => {
  if (!isApiError(error)) {
    // An audit was accepted and is probably still running, so this is lost
    // contact rather than a failed start.
    return {message: UNREACHABLE_POLL, action: 'retry', source: 'poll'};
  }

  // The uuid names nothing, and it is the one poll failure that is permanent.
  if (error.status === 404) {
    return {message: error.message, action: 'none', source: 'poll'};
  }

  return {message: error.message, action: 'retry', source: 'poll'};
};

/**
 * An audit that reached a terminal `failed` state.
 *
 * `retry` for everything, and deliberately over-offered. The server knows which
 * failures are permanent but drops that flag before the wire: `error` arrives
 * as free text with nothing machine-readable beside it. Matching its sentences
 * would re-create the table this file avoids, and offering nothing would deny a
 * retry to the transient cases most likely to succeed. Retrying a permanently
 * blocked address costs one round trip and an identical message.
 *
 * The real fix is a failure code on the response; see the issue filed for it.
 */
export const describeAuditFailure = (audit: AuditResultResponse): DescribedFailure => ({
  message: audit.error ?? GENERIC,
  action: 'retry',
  // A fresh audit, not another poll: this one is terminal and asking again
  // would return the same failure forever.
  source: 'audit',
});

export type FailureSources = {
  /** From `POST /api/audits`. */
  requestError: unknown;
  /** From `GET /api/audits/:uuid`, after its retries are exhausted. */
  pollError: unknown;
  audit: AuditResultResponse | undefined;
};

/**
 * Whichever applies, or null while nothing has gone wrong.
 *
 * A screen has three failure sources and must not have three failure
 * renderers. They arrive at different times through different hooks and read
 * identically to the person waiting.
 *
 * Ordered newest-event-first: a request failure means a fresh submission was
 * just refused, so anything below it is the previous attempt.
 */
export const describeFailure = ({requestError, pollError, audit}: FailureSources): DescribedFailure | null => {
  if (requestError !== null && requestError !== undefined) {
    return describeRequestFailure(requestError);
  }
  if (pollError !== null && pollError !== undefined) {
    return describePollFailure(pollError);
  }
  if (audit?.status === 'failed') {
    return describeAuditFailure(audit);
  }
  return null;
};

/** Narrowed for a caller that wants the rate-limit branch specifically. */
export const isRateLimited = (failure: DescribedFailure): failure is DescribedFailure & {rateLimit: RateLimitedBody} =>
  failure.action === 'signup' && failure.rateLimit !== undefined;
