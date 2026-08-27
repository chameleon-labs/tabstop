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

const allowingLimiter = (): RateLimiter => ({consume: vi.fn(() => Promise.resolve(allowance()))});

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

const quietWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('rate limit middleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls next when the limiter allows the request', async () => {
    const next = vi.fn();
    const sut = makeRateLimit(allowingLimiter(), [{name: 'ip', bucket, key: (req) => req.ip}]);

    await sut(request(), mockRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('answers 429 with Retry-After in whole seconds', async () => {
    const limiter: RateLimiter = {
      consume: vi.fn(() => Promise.resolve({allowed: false as const, retryAfterMs: 1500})),
    };
    const res = mockRes();
    const next = vi.fn();
    const sut = makeRateLimit(limiter, [{name: 'ip', bucket, key: (req) => req.ip}]);

    await sut(request(), res as unknown as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('2');
    expect(res.body).toMatchObject({error: 'Too many requests', retryAfter: 2});
    expect(typeof (res.body as {resetAt: string}).resetAt).toBe('string');
  });

  it('never reports Retry-After: 0, which would invite an immediate retry', async () => {
    const limiter: RateLimiter = {
      consume: vi.fn(() => Promise.resolve({allowed: false as const, retryAfterMs: 10})),
    };
    const res = mockRes();
    const sut = makeRateLimit(limiter, [{name: 'ip', bucket, key: (req) => req.ip}]);

    await sut(request(), res as unknown as Response, vi.fn());

    expect(res.headers['retry-after']).toBe('1');
  });

  it('floors an exact-zero deficit to 1, not 0', async () => {
    const limiter: RateLimiter = {
      consume: vi.fn(() => Promise.resolve({allowed: false as const, retryAfterMs: 0})),
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
    const limiter: RateLimiter = {
      consume: vi.fn(() => Promise.reject(new Error('redis is on fire'))),
    };
    const next = vi.fn();
    const sut = makeRateLimit(limiter, [{name: 'ip', bucket, key: () => 'ip-key'}]);
    const warn = quietWarn();

    await sut(request(), mockRes() as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('Rate limiter threw on consume; failing open:', expect.any(Error));
  });

  it('preserves the denial when the limiter throws on refund', async () => {
    const refund = vi.fn(() => Promise.reject(new Error('redis is on fire')));
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

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(warn).toHaveBeenCalledWith('Rate limiter refund failed; preserving denial:', expect.any(Error));
  });

  it('hands console.warn back before the next test runs', () => {
    expect(vi.isMockFunction(console.warn)).toBe(false);
  });

  it('skips a bucket whose key cannot be derived', async () => {
    const limiter = allowingLimiter();
    const sut = makeRateLimit(limiter, [
      {name: 'ip', bucket, key: (req) => req.ip},
      {
        name: 'email',
        bucket,
        key: (req) => {
          const {email} = req.body as {email?: unknown};
          return typeof email === 'string' ? `email:${email}` : undefined;
        },
      },
    ]);

    await sut(request({body: {}}), mockRes() as unknown as Response, vi.fn());

    expect(limiter.consume).toHaveBeenCalledTimes(1);
  });

  it('normalises the email the same way the validation schema does', () => {
    expect(emailKey(request({body: {email: '  Bob@X.com  '}}))).toBe(emailKey(request({body: {email: 'bob@x.com'}})));
  });

  it('derives no email key from a body that has none', () => {
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

  it('gives two addresses in the same IPv6 /64 the same key', () => {
    expect(ipKey(request({ip: '2001:db8:aaaa:1::1'}))).toBe(ipKey(request({ip: '2001:db8:aaaa:1::2'})));
  });

  it('gives two addresses in different IPv6 /64s different keys', () => {
    expect(ipKey(request({ip: '2001:db8:aaaa:1::1'}))).not.toBe(ipKey(request({ip: '2001:db8:aaaa:2::1'})));
  });

  it('leaves an IPv4 address unchanged', () => {
    expect(ipKey(request({ip: '203.0.113.9'}))).toBe('ip:203.0.113.9');
  });

  it('treats an IPv4-mapped IPv6 address as its IPv4 form, not truncated', () => {
    expect(ipKey(request({ip: '::ffff:203.0.113.9'}))).toBe('ip:203.0.113.9');
  });

  it('does not throw on a malformed address', () => {
    expect(() => ipKey(request({ip: 'not-an-ip'}))).not.toThrow();
  });

  it('still yields a key when no IP can be derived, rather than exempting the request', () => {
    expect(ipKey(request({ip: undefined}))).toBe('ip:unknown');
  });

  it('hashes the email into the key rather than storing it in the clear', () => {
    const key = emailKey(request({body: {email: 'bob@example.com'}}));

    expect(key).not.toContain('bob@example.com');
    expect(key).toMatch(/^email:[0-9a-f]{32}$/);
  });
});
