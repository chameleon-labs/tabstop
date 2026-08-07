import type {Request, Response} from 'express';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {makeRateLimit, emailKey, ipKey} from './rate-limit.js';
import type {BucketConfig, RateLimitAllowance, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';

const bucket: BucketConfig = {capacity: 3, refillPerHour: 60};

const allowance = (refund = vi.fn().mockResolvedValue(undefined)): RateLimitAllowance => ({
  allowed: true,
  remaining: 2,
  refund,
});

const allowingLimiter = (): RateLimiter => ({consume: vi.fn(async () => allowance())});

const mockRes = () => {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    set: vi.fn((name: string, value: string) => {
      res.headers[name] = value;
      return res;
    }),
    status: vi.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
  };
  return res;
};

const request = (overrides: Partial<Request> = {}): Request => ({ip: '203.0.113.9', body: {}, ...overrides}) as Request;

/**
 * Silences the fail-open warning and hands it back to be asserted on.
 *
 * The middleware logs when it swallows a limiter error, which is right - and
 * a spec that drives that path deliberately should not leave the line in CI,
 * where it is indistinguishable from the outage it is imitating. Silencing
 * without asserting would be worse than the noise: it would delete the only
 * evidence the path logs at all.
 *
 * Restored after every test by the hook below. `vitest.config.ts` does not set
 * `restoreMocks`, so a spy installed here otherwise outlives its own test and
 * silently swallows warnings from every later one in the file - which is the
 * same mistake as leaving the noise, made harder to notice.
 */
const quietWarn = () =>
  vi.spyOn(console, 'warn').mockImplementation(() => {
    /* quiet */
  });

describe('rate limit middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls next when the limiter allows the request', async () => {
    // Untyped: vi.fn<NextFunction>() picks one of NextFunction's overloads
    // and stops being assignable to the others, which is a vitest/TS
    // interaction rather than anything about the middleware under test.
    const next = vi.fn();
    const sut = makeRateLimit(allowingLimiter(), [{name: 'ip', bucket, key: (req) => req.ip}]);

    await sut(request(), mockRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('answers 429 with Retry-After in whole seconds', async () => {
    const limiter: RateLimiter = {
      consume: vi.fn(async () => ({allowed: false as const, retryAfterMs: 1500})),
    };
    const res = mockRes();
    const next = vi.fn();
    const sut = makeRateLimit(limiter, [{name: 'ip', bucket, key: (req) => req.ip}]);

    await sut(request(), res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    // Rounded up, and the header admits no unit other than seconds.
    expect(res.headers['retry-after']).toBe('2');
    expect(res.body).toMatchObject({error: 'Too many requests', retryAfter: 2});
    expect(typeof (res.body as {resetAt: string}).resetAt).toBe('string');
  });

  it('never reports Retry-After: 0, which would invite an immediate retry', async () => {
    const limiter: RateLimiter = {
      consume: vi.fn(async () => ({allowed: false as const, retryAfterMs: 10})),
    };
    const res = mockRes();
    const sut = makeRateLimit(limiter, [{name: 'ip', bucket, key: (req) => req.ip}]);

    await sut(request(), res as unknown as Response, vi.fn());

    expect(res.headers['retry-after']).toBe('1');
  });

  it('floors an exact-zero deficit to 1, not 0', async () => {
    // The test above does not actually reach the Math.max(1, ...) floor:
    // Math.ceil(10 / 1000) is already 1, so dropping the floor would not
    // have failed it. Only retryAfterMs: 0 exercises the floor itself - a
    // limiter can legitimately report a zero-millisecond deficit right at
    // the moment a bucket refills to exactly the requested cost.
    const limiter: RateLimiter = {
      consume: vi.fn(async () => ({allowed: false as const, retryAfterMs: 0})),
    };
    const res = mockRes();
    const sut = makeRateLimit(limiter, [{name: 'ip', bucket, key: (req) => req.ip}]);

    await sut(request(), res as unknown as Response, vi.fn());

    expect(res.headers['retry-after']).toBe('1');
  });

  it('consumes every configured bucket', async () => {
    const limiter = allowingLimiter();
    const sut = makeRateLimit(limiter, [
      {name: 'ip', bucket, key: (req) => req.ip},
      {name: 'email', bucket, key: (req) => `email:${String((req.body as {email: string}).email)}`},
    ]);

    await sut(request({body: {email: 'a@b.com'}}), mockRes() as unknown as Response, vi.fn());

    expect(limiter.consume).toHaveBeenCalledTimes(2);
  });

  it('refunds the buckets that allowed when another rejects', async () => {
    // Otherwise one attacker draining the email bucket also drains the shared
    // IP bucket of every legitimate user behind that address.
    const refund = vi.fn().mockResolvedValue(undefined);
    const limiter: RateLimiter = {
      consume: vi
        .fn()
        .mockResolvedValueOnce(allowance(refund))
        .mockResolvedValueOnce({allowed: false, retryAfterMs: 1000}),
    };
    const sut = makeRateLimit(limiter, [
      {name: 'ip', bucket, key: () => 'ip-key'},
      {name: 'email', bucket, key: () => 'email-key'},
    ]);

    await sut(request(), mockRes() as unknown as Response, vi.fn());

    expect(refund).toHaveBeenCalledOnce();
  });

  it('fails open and calls next when the limiter throws on consume', async () => {
    // The factory always wires a FallbackRateLimiter whose own fallback does
    // no I/O, so this throw is unreachable through it - but makeRateLimit is
    // a public seam the unit specs inject bare mocks into directly, and the
    // "never 500s on the limiter's own account" invariant has to hold here
    // too, not only inside that one collaborator.
    const limiter: RateLimiter = {
      consume: vi.fn(async () => {
        throw new Error('redis is on fire');
      }),
    };
    const next = vi.fn();
    const sut = makeRateLimit(limiter, [{name: 'ip', bucket, key: () => 'ip-key'}]);
    // Silenced AND asserted. That warning is the only trace a failing limiter
    // leaves: printed, it reads in CI exactly like the real degradation it is
    // imitating; silenced without an assertion, it would stop being covered
    // at all - so the spec that causes it owns it.
    const warn = quietWarn();

    await sut(request(), mockRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('Rate limiter threw on consume; failing open:', expect.any(Error));
  });

  it('preserves the denial when the limiter throws on refund', async () => {
    const refund = vi.fn(async () => {
      throw new Error('redis is on fire');
    });
    const limiter: RateLimiter = {
      consume: vi
        .fn()
        .mockResolvedValueOnce(allowance(refund))
        .mockResolvedValueOnce({allowed: false, retryAfterMs: 1000}),
    };
    const next = vi.fn();
    const res = mockRes();
    const sut = makeRateLimit(limiter, [
      {name: 'ip', bucket, key: () => 'ip-key'},
      {name: 'email', bucket, key: () => 'email-key'},
    ]);
    const warn = quietWarn();

    await sut(request(), res as unknown as Response, next);

    // A throwing refund must not stop the 429 the second rule already
    // decided on - only the consume path fails open into next().
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(warn).toHaveBeenCalledWith('Rate limiter refund failed; preserving denial:', expect.any(Error));
  });

  it('hands console.warn back before the next test runs', () => {
    // Deliberately placed after the two specs that silence it, and dependent
    // on that order - which is the only position from which it can catch
    // anything. `vitest.config.ts` sets no `restoreMocks`, so without the
    // afterEach above a spy installed by either of them stays installed, and
    // every later test in this file runs with warnings swallowed. Nothing
    // fails when that happens, which is exactly the problem: the file would
    // go quiet about real warnings and stay green.
    expect(vi.isMockFunction(console.warn)).toBe(false);
  });

  it('skips a bucket whose key cannot be derived', async () => {
    // A body with no email is the controller's 400 to issue, not the
    // limiter's - but the IP bucket must still do its work.
    const limiter = allowingLimiter();
    const sut = makeRateLimit(limiter, [
      {name: 'ip', bucket, key: (req) => req.ip},
      {
        name: 'email',
        bucket,
        key: (req) => {
          const email = (req.body as {email?: unknown}).email;
          return typeof email === 'string' ? `email:${email}` : undefined;
        },
      },
    ]);

    await sut(request({body: {}}), mockRes() as unknown as Response, vi.fn());

    expect(limiter.consume).toHaveBeenCalledTimes(1);
  });

  it('normalises the email the same way the validation schema does', async () => {
    // The middleware runs before validation and sees the raw body, so it has
    // to repeat what account-validation-factory.ts:19 does - otherwise
    // `Bob@X.com ` and `bob@x.com` get separate buckets and the per-email
    // limit is trivially evaded by changing case.
    expect(emailKey(request({body: {email: '  Bob@X.com  '}}))).toBe(emailKey(request({body: {email: 'bob@x.com'}})));
  });

  it('derives no email key from a body that has none', async () => {
    expect(emailKey(request({body: {}}))).toBeUndefined();
    expect(emailKey(request({body: {email: 42}}))).toBeUndefined();
    expect(emailKey(request({body: {email: '   '}}))).toBeUndefined();
  });

  it('allows the request when no key at all can be derived', async () => {
    const limiter = allowingLimiter();
    const next = vi.fn();
    const sut = makeRateLimit(limiter, [{name: 'ip', bucket, key: () => undefined}]);

    await sut(request(), mockRes() as unknown as Response, next);

    expect(limiter.consume).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

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
    const limiter = allowingLimiter();
    const sut = makeRateLimit(limiter, [{name: 'audit', bucket, key: ipKey}]);

    await sut(request(), mockRes() as unknown as Response, vi.fn());

    expect(limiter.consume).toHaveBeenCalledWith('audit:ip:203.0.113.9', bucket);
  });

  it('gives two rules on the same requester distinct storage keys purely from their names', async () => {
    const limiter = allowingLimiter();
    const sut = makeRateLimit(limiter, [
      {name: 'audit', bucket, key: ipKey},
      {name: 'auditRead', bucket, key: ipKey},
    ]);

    await sut(request(), mockRes() as unknown as Response, vi.fn());

    const keysSeen = (limiter.consume as ReturnType<typeof vi.fn>).mock.calls.map((call: unknown[]) => call[0]);
    expect(keysSeen).toEqual(['audit:ip:203.0.113.9', 'auditRead:ip:203.0.113.9']);
    expect(new Set(keysSeen).size).toBe(2);
  });

  it('gives two addresses in the same IPv6 /64 the same key', async () => {
    // Every major hosting provider and residential ISP routes at least a
    // /64 to one customer, so keying on the full /128 lets one host mint an
    // unlimited number of buckets just by incrementing the interface
    // identifier.
    expect(ipKey(request({ip: '2001:db8:aaaa:1::1'}))).toBe(ipKey(request({ip: '2001:db8:aaaa:1::2'})));
  });

  it('gives two addresses in different IPv6 /64s different keys', async () => {
    expect(ipKey(request({ip: '2001:db8:aaaa:1::1'}))).not.toBe(ipKey(request({ip: '2001:db8:aaaa:2::1'})));
  });

  it('leaves an IPv4 address unchanged', async () => {
    expect(ipKey(request({ip: '203.0.113.9'}))).toBe('ip:203.0.113.9');
  });

  it('treats an IPv4-mapped IPv6 address as its IPv4 form, not truncated', async () => {
    expect(ipKey(request({ip: '::ffff:203.0.113.9'}))).toBe('ip:203.0.113.9');
  });

  it('does not throw on a malformed address', async () => {
    expect(() => ipKey(request({ip: 'not-an-ip'}))).not.toThrow();
  });

  it('still yields a key when no IP can be derived, rather than exempting the request', async () => {
    // proxy-addr returns undefined when the socket was already destroyed, so
    // a client that writes a full request and immediately resets the
    // connection must share a bucket with every other unidentifiable
    // requester, not skip the rule entirely.
    expect(ipKey(request({ip: undefined}))).toBe('ip:unknown');
  });

  it('hashes the email into the key rather than storing it in the clear', async () => {
    // This Redis instance also backs BullMQ, so a plaintext
    // `email:bob@example.com` key is readable by SCAN, a leaked RDB, or
    // MONITOR/slowlog output - an enumerable list of every address that has
    // ever attempted to log in.
    const key = emailKey(request({body: {email: 'bob@example.com'}}));

    expect(key).not.toContain('bob@example.com');
    expect(key).toMatch(/^email:[0-9a-f]{32}$/);
  });
});
