import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { makeRateLimit, emailKey, ipKey, namespaced } from './rate-limit.js'
import type {
  BucketConfig, RateLimiter
} from '../../data/protocols/rate-limit/rate-limiter.js'

const bucket: BucketConfig = { capacity: 3, refillPerHour: 60 }

const allowingLimiter = (): RateLimiter => ({
  consume: vi.fn(async () => ({ allowed: true as const, remaining: 2 })),
  refund: vi.fn(async () => { /* no-op */ })
})

const mockRes = () => {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    set: vi.fn((name: string, value: string) => { res.headers[name] = value; return res }),
    status: vi.fn((code: number) => { res.statusCode = code; return res }),
    json: vi.fn((payload: unknown) => { res.body = payload; return res })
  }
  return res
}

const request = (overrides: Partial<Request> = {}): Request =>
  ({ ip: '203.0.113.9', body: {}, ...overrides }) as Request

describe('rate limit middleware', () => {
  it('calls next when the limiter allows the request', async () => {
    // Untyped: vi.fn<NextFunction>() picks one of NextFunction's overloads
    // and stops being assignable to the others, which is a vitest/TS
    // interaction rather than anything about the middleware under test.
    const next = vi.fn()
    const sut = makeRateLimit(allowingLimiter(), [{ bucket, key: (req) => req.ip }])

    await sut(request(), mockRes() as unknown as Response, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('answers 429 with Retry-After in whole seconds', async () => {
    const limiter: RateLimiter = {
      consume: vi.fn(async () => ({ allowed: false as const, retryAfterMs: 1500 })),
      refund: vi.fn(async () => { /* no-op */ })
    }
    const res = mockRes()
    const next = vi.fn()
    const sut = makeRateLimit(limiter, [{ bucket, key: (req) => req.ip }])

    await sut(request(), res as unknown as Response, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(429)
    // Rounded up, and the header admits no unit other than seconds.
    expect(res.headers['retry-after']).toBe('2')
    expect(res.body).toMatchObject({ error: 'Too many requests', retryAfter: 2 })
    expect(typeof (res.body as { resetAt: string }).resetAt).toBe('string')
  })

  it('never reports Retry-After: 0, which would invite an immediate retry', async () => {
    const limiter: RateLimiter = {
      consume: vi.fn(async () => ({ allowed: false as const, retryAfterMs: 10 })),
      refund: vi.fn(async () => { /* no-op */ })
    }
    const res = mockRes()
    const sut = makeRateLimit(limiter, [{ bucket, key: (req) => req.ip }])

    await sut(request(), res as unknown as Response, vi.fn())

    expect(res.headers['retry-after']).toBe('1')
  })

  it('floors an exact-zero deficit to 1, not 0', async () => {
    // The test above does not actually reach the Math.max(1, ...) floor:
    // Math.ceil(10 / 1000) is already 1, so dropping the floor would not
    // have failed it. Only retryAfterMs: 0 exercises the floor itself - a
    // limiter can legitimately report a zero-millisecond deficit right at
    // the moment a bucket refills to exactly the requested cost.
    const limiter: RateLimiter = {
      consume: vi.fn(async () => ({ allowed: false as const, retryAfterMs: 0 })),
      refund: vi.fn(async () => { /* no-op */ })
    }
    const res = mockRes()
    const sut = makeRateLimit(limiter, [{ bucket, key: (req) => req.ip }])

    await sut(request(), res as unknown as Response, vi.fn())

    expect(res.headers['retry-after']).toBe('1')
  })

  it('consumes every configured bucket', async () => {
    const limiter = allowingLimiter()
    const sut = makeRateLimit(limiter, [
      { bucket, key: (req) => req.ip },
      { bucket, key: (req) => `email:${String((req.body as { email: string }).email)}` }
    ])

    await sut(request({ body: { email: 'a@b.com' } }), mockRes() as unknown as Response, vi.fn())

    expect(limiter.consume).toHaveBeenCalledTimes(2)
  })

  it('refunds the buckets that allowed when another rejects', async () => {
    // Otherwise one attacker draining the email bucket also drains the shared
    // IP bucket of every legitimate user behind that address.
    const limiter: RateLimiter = {
      consume: vi.fn()
        .mockResolvedValueOnce({ allowed: true, remaining: 2 })
        .mockResolvedValueOnce({ allowed: false, retryAfterMs: 1000 }),
      refund: vi.fn(async () => { /* no-op */ })
    }
    const sut = makeRateLimit(limiter, [
      { bucket, key: () => 'ip-key' },
      { bucket, key: () => 'email-key' }
    ])

    await sut(request(), mockRes() as unknown as Response, vi.fn())

    expect(limiter.refund).toHaveBeenCalledWith('ip-key', bucket)
    expect(limiter.refund).not.toHaveBeenCalledWith('email-key', bucket)
  })

  it('skips a bucket whose key cannot be derived', async () => {
    // A body with no email is the controller's 400 to issue, not the
    // limiter's - but the IP bucket must still do its work.
    const limiter = allowingLimiter()
    const sut = makeRateLimit(limiter, [
      { bucket, key: (req) => req.ip },
      { bucket, key: (req) => {
        const email = (req.body as { email?: unknown }).email
        return typeof email === 'string' ? `email:${email}` : undefined
      } }
    ])

    await sut(request({ body: {} }), mockRes() as unknown as Response, vi.fn())

    expect(limiter.consume).toHaveBeenCalledTimes(1)
  })

  it('normalises the email the same way the validation schema does', async () => {
    // The middleware runs before validation and sees the raw body, so it has
    // to repeat what account-validation-factory.ts:19 does - otherwise
    // `Bob@X.com ` and `bob@x.com` get separate buckets and the per-email
    // limit is trivially evaded by changing case.
    expect(emailKey(request({ body: { email: '  Bob@X.com  ' } })))
      .toBe(emailKey(request({ body: { email: 'bob@x.com' } })))
  })

  it('derives no email key from a body that has none', async () => {
    expect(emailKey(request({ body: {} }))).toBeUndefined()
    expect(emailKey(request({ body: { email: 42 } }))).toBeUndefined()
    expect(emailKey(request({ body: { email: '   ' } }))).toBeUndefined()
  })

  it('allows the request when no key at all can be derived', async () => {
    const limiter = allowingLimiter()
    const next = vi.fn()
    const sut = makeRateLimit(limiter, [{ bucket, key: () => undefined }])

    await sut(request(), mockRes() as unknown as Response, next)

    expect(limiter.consume).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
  })

  it('gives two rules on the same requester distinct storage keys', () => {
    // Both token bucket implementations key their storage purely on this
    // string, with no awareness of which BucketConfig it was called with. A
    // bare ipKey returns the identical "ip:<address>" for every rule, so
    // without a namespace, e.g. RATE_LIMITS.audit and RATE_LIMITS.auditRead
    // would silently share one counter per address.
    const req = request()

    expect(namespaced('audit', ipKey)(req)).not.toBe(namespaced('auditRead', ipKey)(req))
  })

  it('still reports no key when the wrapped key function reports none', () => {
    expect(namespaced('audit', () => undefined)(request())).toBeUndefined()
  })
})
