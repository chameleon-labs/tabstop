import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {FallbackRateLimiter} from './fallback-rate-limiter.js';
import type {BucketConfig, RateLimitAllowance, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';

const bucket: BucketConfig = {capacity: 3, refillPerHour: 1};

const allowance = (refund = vi.fn().mockResolvedValue(undefined)): RateLimitAllowance => ({
  allowed: true,
  remaining: 2,
  refund,
});

const mockLimiter = (): RateLimiter & {
  consume: ReturnType<typeof vi.fn>;
} => ({
  consume: vi.fn(() => Promise.resolve(allowance())),
});

describe('FallbackRateLimiter', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('uses the primary while it works', async () => {
    const primary = mockLimiter();
    const fallback = mockLimiter();
    const sut = new FallbackRateLimiter(primary, fallback);

    await sut.consume('a', bucket);

    expect(primary.consume).toHaveBeenCalledWith('a', bucket, 1);
    expect(fallback.consume).not.toHaveBeenCalled();
  });

  it('still limits when the primary fails, rather than allowing everything', async () => {
    const primary = mockLimiter();
    const fallback = mockLimiter();
    primary.consume.mockRejectedValue(new Error('ECONNREFUSED'));
    const sut = new FallbackRateLimiter(primary, fallback);

    const decision = await sut.consume('a', bucket);

    expect(decision.allowed).toBe(true);
    expect(fallback.consume).toHaveBeenCalledWith('a', bucket, 1);
  });

  it('does not swallow the primary failure silently', async () => {
    const primary = mockLimiter();
    primary.consume.mockRejectedValue(new Error('ECONNREFUSED'));

    await new FallbackRateLimiter(primary, mockLimiter()).consume('a', bucket);

    expect(warn).toHaveBeenCalledWith('Rate limiter falling back to in-process buckets:', expect.any(Error));
  });

  it('logs the outage once rather than once per request', async () => {
    const primary = mockLimiter();
    primary.consume.mockRejectedValue(new Error('ECONNREFUSED'));
    const sut = new FallbackRateLimiter(primary, mockLimiter());

    for (let i = 0; i < 50; i++) {
      await sut.consume('a', bucket);
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns to the primary once it recovers, after the degraded window', async () => {
    vi.useFakeTimers();
    try {
      const primary = mockLimiter();
      const fallback = mockLimiter();
      primary.consume.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const sut = new FallbackRateLimiter(primary, fallback);

      await sut.consume('a', bucket);

      await sut.consume('a', bucket);
      expect(primary.consume).toHaveBeenCalledTimes(1);
      expect(fallback.consume).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(5_000);
      await sut.consume('a', bucket);

      expect(primary.consume).toHaveBeenCalledTimes(2);
      expect(fallback.consume).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refunds an earlier primary consume after a later consume degrades', async () => {
    const primary = mockLimiter();
    const fallback = mockLimiter();
    const primaryRefund = vi.fn().mockResolvedValue(undefined);
    const fallbackRefund = vi.fn().mockResolvedValue(undefined);
    primary.consume
      .mockResolvedValueOnce(allowance(primaryRefund))
      .mockRejectedValueOnce(new Error('redis unavailable'));
    fallback.consume.mockResolvedValueOnce(allowance(fallbackRefund));
    const sut = new FallbackRateLimiter(primary, fallback);

    const first = await sut.consume('first', bucket);
    await sut.consume('second', bucket);
    if (!first.allowed) {
      throw new Error('expected allowance');
    }
    await first.refund();

    expect(primaryRefund).toHaveBeenCalledOnce();
    expect(fallbackRefund).not.toHaveBeenCalled();
  });

  it('refunds a fallback allowance after the primary recovers', async () => {
    vi.useFakeTimers();
    try {
      const primary = mockLimiter();
      const fallback = mockLimiter();
      const primaryRefund = vi.fn().mockResolvedValue(undefined);
      const fallbackRefund = vi.fn().mockResolvedValue(undefined);
      primary.consume.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(allowance(primaryRefund));
      fallback.consume.mockResolvedValueOnce(allowance(fallbackRefund));
      const sut = new FallbackRateLimiter(primary, fallback);

      const first = await sut.consume('ip:1.2.3.4', bucket);
      vi.advanceTimersByTime(5_000);
      await sut.consume('primary-is-healthy-again', bucket);
      if (!first.allowed) {
        throw new Error('expected allowance');
      }
      await first.refund();

      expect(fallbackRefund).toHaveBeenCalledOnce();
      expect(primaryRefund).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
