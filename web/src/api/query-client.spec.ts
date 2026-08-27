import {describe, expect, it} from 'vitest';
import {ApiError} from './client';
import {makeQueryClient} from './query-client';

const retryOf = (client = makeQueryClient()): ((count: number, error: unknown) => boolean) => {
  const retry = client.getDefaultOptions().queries?.retry;
  if (typeof retry !== 'function') {
    throw new Error('queries.retry is not a predicate');
  }
  return retry as (count: number, error: unknown) => boolean;
};

describe('the query client retry policy', () => {
  const retry = retryOf();

  it('does not retry a 400, because the same invalid body will fail again', () => {
    expect(retry(0, new ApiError(400, 'A url is required', null))).toBe(false);
  });

  it('does not retry a 429 - retrying a rate limit is actively harmful', () => {
    expect(retry(0, new ApiError(429, 'Too many requests', null))).toBe(false);
  });

  it('does not retry a 401, so a signed-out visitor is not held on a spinner', () => {
    expect(retry(0, new ApiError(401, 'Unauthorized', null))).toBe(false);
  });

  it('does not retry a 404', () => {
    expect(retry(0, new ApiError(404, 'Audit not found', null))).toBe(false);
  });

  it('retries a 500, which may genuinely be transient', () => {
    expect(retry(0, new ApiError(500, 'Internal server error', null))).toBe(true);
  });

  it('retries a fetch rejection, which is not an ApiError at all', () => {
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true);
  });

  it('gives up rather than retrying a 500 forever', () => {
    expect(retry(1, new ApiError(500, 'nope', null))).toBe(true);
    expect(retry(2, new ApiError(500, 'nope', null))).toBe(false);
  });

  it('never retries a mutation', () => {
    expect(makeQueryClient().getDefaultOptions().mutations?.retry).toBe(false);
  });

  it('gives each caller its own client, so one test cannot warm another', () => {
    expect(makeQueryClient()).not.toBe(makeQueryClient());
  });
});
