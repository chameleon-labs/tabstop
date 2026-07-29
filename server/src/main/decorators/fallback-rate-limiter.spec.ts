import { describe, expect, it, vi } from 'vitest'
import { FallbackRateLimiter } from './fallback-rate-limiter.js'
import type {
  BucketConfig, RateLimiter
} from '../../data/protocols/rate-limit/rate-limiter.js'

const bucket: BucketConfig = { capacity: 3, refillPerHour: 1 }

const mockLimiter = (): RateLimiter & {
  consume: ReturnType<typeof vi.fn>
  refund: ReturnType<typeof vi.fn>
} => ({
  consume: vi.fn(async () => ({ allowed: true as const, remaining: 2 })),
  refund: vi.fn(async () => { /* no-op */ })
})

describe('FallbackRateLimiter', () => {
  it('uses the primary while it works', async () => {
    const primary = mockLimiter()
    const fallback = mockLimiter()
    const sut = new FallbackRateLimiter(primary, fallback)

    await sut.consume('a', bucket)

    expect(primary.consume).toHaveBeenCalledWith('a', bucket, 1)
    expect(fallback.consume).not.toHaveBeenCalled()
  })

  it('still limits when the primary fails, rather than allowing everything', async () => {
    // The whole point: Redis being unreachable must not disable the limiter,
    // and must not deny the request either.
    const primary = mockLimiter()
    const fallback = mockLimiter()
    primary.consume.mockRejectedValue(new Error('ECONNREFUSED'))
    const sut = new FallbackRateLimiter(primary, fallback)

    const decision = await sut.consume('a', bucket)

    expect(decision.allowed).toBe(true)
    expect(fallback.consume).toHaveBeenCalledWith('a', bucket, 1)
  })

  it('does not swallow the primary failure silently', async () => {
    const primary = mockLimiter()
    primary.consume.mockRejectedValue(new Error('ECONNREFUSED'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ })

    await new FallbackRateLimiter(primary, mockLimiter()).consume('a', bucket)

    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('logs the outage once rather than once per request', async () => {
    // An outage that logged per request would do more damage than the outage.
    const primary = mockLimiter()
    primary.consume.mockRejectedValue(new Error('ECONNREFUSED'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => { /* quiet */ })
    const sut = new FallbackRateLimiter(primary, mockLimiter())

    for (let i = 0; i < 50; i++) await sut.consume('a', bucket)

    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('returns to the primary once it recovers, after the degraded window', async () => {
    vi.useFakeTimers()
    try {
      const primary = mockLimiter()
      const fallback = mockLimiter()
      primary.consume.mockRejectedValueOnce(new Error('ECONNREFUSED'))
      const sut = new FallbackRateLimiter(primary, fallback)

      await sut.consume('a', bucket)

      // Still inside the window: the primary is not retried yet, which is
      // what keeps a dead Redis from charging every request its timeout.
      await sut.consume('a', bucket)
      expect(primary.consume).toHaveBeenCalledTimes(1)
      expect(fallback.consume).toHaveBeenCalledTimes(2)

      vi.advanceTimersByTime(5_000)
      await sut.consume('a', bucket)

      expect(primary.consume).toHaveBeenCalledTimes(2)
      expect(fallback.consume).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('refunds to whichever backend served the consume', async () => {
    // makeRateLimit takes a token from the per-IP bucket, then finds the
    // per-email bucket empty, and gives the first one back. If Redis was down
    // for the consume and up again by the refund - milliseconds later, which
    // is exactly what a flapping connection looks like - a naive
    // try-primary-first refund credits Redis for a token it never issued and
    // leaves the memory bucket debited for good.
    const primary = mockLimiter()
    const fallback = mockLimiter()
    primary.consume.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const sut = new FallbackRateLimiter(primary, fallback)

    await sut.consume('ip:1.2.3.4', bucket)
    // The primary is healthy again by now, and must still not be the one
    // refunded.
    await sut.refund('ip:1.2.3.4', bucket)

    expect(fallback.refund).toHaveBeenCalledWith('ip:1.2.3.4', bucket, 1)
    expect(primary.refund).not.toHaveBeenCalled()
  })

  it('falls back on refund too', async () => {
    const primary = mockLimiter()
    const fallback = mockLimiter()
    primary.refund.mockRejectedValue(new Error('ECONNREFUSED'))
    const sut = new FallbackRateLimiter(primary, fallback)

    await sut.refund('a', bucket)

    expect(fallback.refund).toHaveBeenCalledWith('a', bucket, 1)
  })
})
