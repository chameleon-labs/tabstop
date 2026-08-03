import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { makeQueryClient } from './query-client'

/**
 * The retry predicate, read back off a constructed client rather than exported
 * separately - so this tests the policy the app actually runs with. Exporting
 * the function and testing that instead would pass happily while the client was
 * built with a different one.
 */
const retryOf = (client = makeQueryClient()): ((count: number, error: unknown) => boolean) => {
  const retry = client.getDefaultOptions().queries?.retry
  if (typeof retry !== 'function') throw new Error('queries.retry is not a predicate')
  return retry as (count: number, error: unknown) => boolean
}

describe('the query client retry policy', () => {
  const retry = retryOf()

  it('does not retry a 400, because the same invalid body will fail again', () => {
    expect(retry(0, new ApiError(400, 'A url is required', null))).toBe(false)
  })

  it('does not retry a 429 - retrying a rate limit is actively harmful', () => {
    // The bucket is empty. Each retry is another denial charged to whoever
    // shares that address, and the response already says when to come back.
    expect(retry(0, new ApiError(429, 'Too many requests', null))).toBe(false)
  })

  it('does not retry a 401, so a signed-out visitor is not held on a spinner', () => {
    expect(retry(0, new ApiError(401, 'Unauthorized', null))).toBe(false)
  })

  it('does not retry a 404', () => {
    expect(retry(0, new ApiError(404, 'Audit not found', null))).toBe(false)
  })

  it('retries a 500, which may genuinely be transient', () => {
    expect(retry(0, new ApiError(500, 'Internal server error', null))).toBe(true)
  })

  it('retries a fetch rejection, which is not an ApiError at all', () => {
    // Offline, DNS, connection refused: the request never got an answer, so
    // there is nothing considered about it to respect.
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true)
  })

  it('gives up rather than retrying a 500 forever', () => {
    expect(retry(1, new ApiError(500, 'nope', null))).toBe(true)
    expect(retry(2, new ApiError(500, 'nope', null))).toBe(false)
  })

  it('never retries a mutation', () => {
    // A mutation is not safe to repeat: `POST /api/audits` a second time is a
    // second thirty seconds of Chromium, and a second charge against the
    // caller's rate limit.
    expect(makeQueryClient().getDefaultOptions().mutations?.retry).toBe(false)
  })

  it('gives each caller its own client, so one test cannot warm another', () => {
    expect(makeQueryClient()).not.toBe(makeQueryClient())
  })
})
