import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { makeRateLimit, emailKey, ipKey } from './rate-limit.js'
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
    const sut = makeRateLimit(allowingLimiter(), [{ name: 'ip', bucket, key: (req) => req.ip }])

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
    const sut = makeRateLimit(limiter, [{ name: 'ip', bucket, key: (req) => req.ip }])

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
    const sut = makeRateLimit(limiter, [{ name: 'ip', bucket, key: (req) => req.ip }])

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
    const sut = makeRateLimit(limiter, [{ name: 'ip', bucket, key: (req) => req.ip }])

    await sut(request(), res as unknown as Response, vi.fn())

    expect(res.headers['retry-after']).toBe('1')
  })

  it('consumes every configured bucket', async () => {
    const limiter = allowingLimiter()
    const sut = makeRateLimit(limiter, [
      { name: 'ip', bucket, key: (req) => req.ip },
      { name: 'email', bucket, key: (req) => `email:${String((req.body as { email: string }).email)}` }
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
      { name: 'ip', bucket, key: () => 'ip-key' },
      { name: 'email', bucket, key: () => 'email-key' }
    ])

    await sut(request(), mockRes() as unknown as Response, vi.fn())

    // The middleware itself prefixes the key with the rule's name (that is
    // what closes the collision bug), so the refund call carries that same
    // prefixed key, not the bare string the rule's `key` function returned.
    expect(limiter.refund).toHaveBeenCalledWith('ip:ip-key', bucket)
    expect(limiter.refund).not.toHaveBeenCalledWith('email:email-key', bucket)
  })

  it('skips a bucket whose key cannot be derived', async () => {
    // A body with no email is the controller's 400 to issue, not the
    // limiter's - but the IP bucket must still do its work.
    const limiter = allowingLimiter()
    const sut = makeRateLimit(limiter, [
      { name: 'ip', bucket, key: (req) => req.ip },
      { name: 'email', bucket, key: (req) => {
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
    const sut = makeRateLimit(limiter, [{ name: 'ip', bucket, key: () => undefined }])

    await sut(request(), mockRes() as unknown as Response, next)

    expect(limiter.consume).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledOnce()
  })

  it("prefixes every rule's key with its own name before it reaches the limiter", async () => {
    // Both token bucket implementations key their storage purely on the
    // string handed to consume/refund - they never see the BucketConfig
    // alongside it. `ipKey` alone returns the identical "ip:<address>" for
    // every IP-keyed rule, so without this prefix, two differently-named
    // rules built from the same key function (e.g. RATE_LIMITS.audit and
    // RATE_LIMITS.auditRead, both keyed on ipKey) would silently share one
    // counter per address. `name` is required on RateLimitRule and the
    // prefix is applied inside makeRateLimit itself - not opt-in at the call
    // site - so a new rule cannot be wired up without a namespace.
    const limiter = allowingLimiter()
    const sut = makeRateLimit(limiter, [{ name: 'audit', bucket, key: ipKey }])

    await sut(request(), mockRes() as unknown as Response, vi.fn())

    expect(limiter.consume).toHaveBeenCalledWith('audit:ip:203.0.113.9', bucket)
  })

  it('gives two rules on the same requester distinct storage keys purely from their names', async () => {
    const limiter = allowingLimiter()
    const sut = makeRateLimit(limiter, [
      { name: 'audit', bucket, key: ipKey },
      { name: 'auditRead', bucket, key: ipKey }
    ])

    await sut(request(), mockRes() as unknown as Response, vi.fn())

    const keysSeen = (limiter.consume as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => call[0]
    )
    expect(keysSeen).toEqual(['audit:ip:203.0.113.9', 'auditRead:ip:203.0.113.9'])
    expect(new Set(keysSeen).size).toBe(2)
  })
})
