import type { AuditResultResponse } from '@tabstop/contract'
import { describe, expect, it } from 'vitest'
import { describeAuditFailure, describeFailure, describeRequestFailure, isRateLimited } from './failure'
import { ApiError } from '../api/client'

const audit = (over: Partial<AuditResultResponse> = {}): AuditResultResponse => ({
  auditId: 'abc', url: 'https://example.com/', status: 'done',
  createdAt: '2026-08-03T09:00:00.000Z', completedAt: null,
  score: null, countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
  axeVersion: null, settled: true, error: null, violations: [],
  ...over
})

describe('describeRequestFailure', () => {
  it('turns a 429 into a signup offer rather than an error', () => {
    // The conversion moment. Someone who has audited enough pages to hit the
    // anonymous limit has demonstrated the product's value more convincingly
    // than any landing page could.
    const error = new ApiError(429, 'Too many requests', {
      error: 'Too many requests', retryAfter: 45, resetAt: '2026-08-03T10:00:00.000Z'
    })

    const failure = describeRequestFailure(error)

    expect(failure.action).toBe('signup')
    expect(isRateLimited(failure)).toBe(true)
  })

  it('carries the reset time, so the offer can show a countdown', () => {
    const resetAt = '2026-08-03T10:00:00.000Z'
    const error = new ApiError(429, 'Too many requests', {
      error: 'Too many requests', retryAfter: 45, resetAt
    })

    expect(describeRequestFailure(error).rateLimit).toEqual({
      error: 'Too many requests', retryAfter: 45, resetAt
    })
  })

  it('does not claim a signup offer when the 429 body was unusable', () => {
    // `rateLimitOf` rejects a malformed body, and a countdown is the whole
    // point of this branch - offering one with no time to count to would render
    // NaN at someone already being told to wait.
    const error = new ApiError(429, 'Too many requests', { error: 'Too many requests' })

    const failure = describeRequestFailure(error)

    expect(failure.action).not.toBe('signup')
    expect(isRateLimited(failure)).toBe(false)
  })

  it('sends a 400 back to the URL, since retrying it cannot help', () => {
    // #7 refusing the address: blocked scheme, port, private address, embedded
    // credentials. Every one is a property of the URL.
    const error = new ApiError(400, "That address can't be audited", {})

    expect(describeRequestFailure(error)).toEqual({
      message: "That address can't be audited", action: 'check-url'
    })
  })

  it('quotes the server rather than writing its own sentence', () => {
    // Eight of these already exist server-side, written for a person. A ninth
    // table here would drift the first time either side is reworded.
    const error = new ApiError(400, 'Remove the username and password from that URL', {})

    expect(describeRequestFailure(error).message)
      .toBe('Remove the username and password from that URL')
  })

  it('offers a retry on a 503, which is the queue asking for one', () => {
    const error = new ApiError(503, 'Could not queue that audit, please try again', {})

    expect(describeRequestFailure(error).action).toBe('retry')
  })

  it('offers a retry on a 500', () => {
    expect(describeRequestFailure(new ApiError(500, 'Internal server error', null)).action)
      .toBe('retry')
  })

  it('offers a retry when the request never reached the server', () => {
    // Offline, DNS, connection refused. Nothing considered the request, so
    // there is nothing considered to respect.
    expect(describeRequestFailure(new TypeError('Failed to fetch')))
      .toEqual({ message: 'Something went wrong', action: 'retry' })
  })

  it('offers nothing for a 4xx it has no answer for', () => {
    // Better than inventing an affordance. A button that cannot work is worse
    // than no button.
    expect(describeRequestFailure(new ApiError(403, 'Forbidden', null)).action).toBe('none')
  })

  it('branches on status, not on message text', () => {
    // The reason this is testable at all: a status is a contract, a sentence is
    // prose, and improving wording is exactly what a team does to an error
    // message. Same status, different words - same decision.
    const first = describeRequestFailure(new ApiError(400, "That address can't be audited", {}))
    const reworded = describeRequestFailure(new ApiError(400, 'We cannot audit that address', {}))

    expect(reworded.action).toBe(first.action)
    expect(reworded.message).toBe('We cannot audit that address')
  })
})

describe('describeAuditFailure', () => {
  it('quotes the failure the server recorded', () => {
    expect(describeAuditFailure(audit({ status: 'failed', error: 'Could not resolve that domain' })))
      .toEqual({ message: 'Could not resolve that domain', action: 'retry' })
  })

  it('still says something when a failed audit recorded no reason', () => {
    expect(describeAuditFailure(audit({ status: 'failed', error: null })).message)
      .toBe('Something went wrong')
  })

  it('offers a retry even on a permanently blocked address, deliberately', () => {
    // Documented over-offer. The server KNOWS which failures are permanent -
    // `classifyAuditError` returns `permanent: boolean` - but drops it before
    // the wire, so the client cannot tell. Of the three available mistakes,
    // this is the mild one: a wasted round trip and an identical message.
    // Matching the server's sentences instead would rebuild the table this
    // module exists to avoid; offering nothing would deny a retry to the
    // timeout and transient cases, which are the ones most likely to work.
    expect(describeAuditFailure(audit({ status: 'failed', error: "That address can't be audited" })))
      .toEqual({ message: "That address can't be audited", action: 'retry' })
  })
})

describe('describeFailure', () => {
  it('is null while nothing has gone wrong', () => {
    expect(describeFailure(null, audit({ status: 'running' }))).toBeNull()
    expect(describeFailure(null, undefined)).toBeNull()
    expect(describeFailure(null, audit({ status: 'done' }))).toBeNull()
  })

  it('reports a refused request', () => {
    expect(describeFailure(new ApiError(400, 'nope', {}), undefined)?.action).toBe('check-url')
  })

  it('reports an audit that ended in failed', () => {
    expect(describeFailure(null, audit({ status: 'failed', error: 'boom' }))?.message).toBe('boom')
  })

  it('prefers the request failure when somehow both are present', () => {
    // A screen has two failure sources arriving at different times through
    // different hooks, and must not have two failure renderers. The request
    // failure wins because it is the newer event: it means a fresh submission
    // was refused, and the stale audit below it is the previous attempt.
    const failure = describeFailure(
      new ApiError(429, 'Too many requests', {
        error: 'Too many requests', retryAfter: 30, resetAt: '2026-08-03T10:00:00.000Z'
      }),
      audit({ status: 'failed', error: 'Could not resolve that domain' })
    )

    expect(failure?.action).toBe('signup')
  })
})
