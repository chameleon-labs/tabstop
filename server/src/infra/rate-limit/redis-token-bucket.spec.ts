import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {Redis} from 'ioredis';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {READY_TIMEOUT_MS, RedisTokenBucket, WAIT_MS_FORMULA} from './redis-token-bucket.js';
import type {BucketConfig} from '../../data/protocols/rate-limit/rate-limiter.js';

const connectionUrl = (): string => {
  const url = process.env.REDIS_URL;
  if (url === undefined) {
    throw new Error('REDIS_URL not set by globalSetup');
  }
  return url;
};

/** One token per 100ms, so refill is observable without a slow spec. */
const fast: BucketConfig = {capacity: 3, refillPerHour: 36_000};
/** Effectively no refill, so burst behaviour can be asserted without a race. */
const frozen: BucketConfig = {capacity: 3, refillPerHour: 1};

describe('RedisTokenBucket', () => {
  let redis: Redis;
  let sut: RedisTokenBucket;

  beforeAll(() => {
    redis = new Redis(connectionUrl());
    sut = new RedisTokenBucket(redis);
  });

  afterAll(async () => {
    await redis.quit();
  });

  const key = (): string => `spec-${randomUUID()}`;

  it('never oversells under concurrency', async () => {
    // The reason the whole thing is one Lua script. A read-then-write from
    // Node lets two callers both see the last token and both proceed.
    const k = key();

    const results = await Promise.all(Array.from({length: 20}, async () => await sut.consume(k, frozen)));

    expect(results.filter((result) => result.allowed)).toHaveLength(3);
  });

  it('sets a bounded TTL after refunding an allowance', async () => {
    const k = key();
    const allowance = await sut.consume(k, frozen);
    if (!allowance.allowed) {
      throw new Error('expected allowance');
    }
    await allowance.refund();

    const ttl = await redis.pttl(`rl:${k}`);

    expect(ttl).toBeGreaterThan(0); // the mutation deletes the key, so pttl is -2
    expect(ttl).toBeLessThanOrEqual(1_100);
  });

  it('expires an idle bucket rather than keeping a key per caller forever', async () => {
    const k = key();
    await sut.consume(k, fast);

    const ttl = await redis.pttl(`rl:${k}`);

    expect(ttl).toBeGreaterThan(0);
    // Time to refill what was taken, plus a second of grace.
    expect(ttl).toBeLessThanOrEqual(1_100);
  });

  it('does not overshoot the wait by a millisecond at an exact-boundary deficit', async () => {
    // A real consume() can't drive this deterministically: forcing SCRIPT's
    // own `tokens` to land at precisely `cost - 1` (a deficit of exactly one
    // token) would mean racing Redis's TIME() call, and a timing-dependent
    // spec is not evidence either way - it would pass or fail depending on
    // machine speed and load, not on whether the formula is correct. So this
    // evals WAIT_MS_FORMULA directly, against a real Lua interpreter, with
    // the exact inputs (deficit of 1, refillPerHour 1) that overshoot with
    // the naive `(cost - tokens) / refillPerMs` form: 3_600_001 instead of
    // 3_600_000. Sharing the formula string with the production script is
    // what keeps this from silently drifting out of sync with it.
    const script = `
      local cost = tonumber(ARGV[1])
      local tokens = tonumber(ARGV[2])
      local refillPerHour = tonumber(ARGV[3])
      local msPerHour = tonumber(ARGV[4])
      -- Defined so the formula string works whichever form it's in - the
      -- naive pre-fix version divides by this instead of multiplying by
      -- msPerHour directly.
      local refillPerMs = refillPerHour / msPerHour
      return math.ceil(${WAIT_MS_FORMULA})
    `;

    const result = await redis.eval(script, 0, 1, 0, 1, 3_600_000);

    expect(Number(result)).toBe(3_600_000);
  });

  describe('a connection that is still coming up', () => {
    /**
     * A client with the production options, used the instant it exists.
     *
     * `enableOfflineQueue: false` is what makes a dead Redis reject instead of
     * hang, and it treats "not yet connected" the same way - so a command
     * issued in the tick after construction fails with "Stream isn't writeable
     * and enableOfflineQueue options is false". Not a hypothetical shape: it
     * is what the API process does with the first request it serves, and what
     * CI logged on the first test in every route file.
     */
    const coldClient = (url: string): Redis => {
      const client = new Redis(url, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 250,
      });
      // The factory attaches one for the same reason: an EventEmitter with no
      // error listener takes the process down.
      client.on('error', () => {
        /* expected while connecting, or when refused */
      });
      return client;
    };

    it('serves a command issued before the socket is writable', async () => {
      const client = coldClient(connectionUrl());
      try {
        // Nothing awaited between construction and use, so the status here is
        // `connecting` - which is the whole point.
        expect(client.status).not.toBe('ready');

        const decision = await new RedisTokenBucket(client).consume(key(), frozen);

        expect(decision.allowed).toBe(true);
      } finally {
        await client.quit().catch(() => {
          client.disconnect();
        });
      }
    });

    it('records that consume in Redis, rather than only appearing to succeed', async () => {
      // The assertion that matters. Degrading also answers `allowed: true` -
      // the in-process bucket is happy to - so the observable difference is
      // whether the shared bucket was actually written.
      const client = coldClient(connectionUrl());
      const bucketKey = key();
      try {
        await new RedisTokenBucket(client).consume(bucketKey, frozen);

        expect(await redis.exists(`rl:${bucketKey}`)).toBe(1);
      } finally {
        await client.quit().catch(() => {
          client.disconnect();
        });
      }
    });

    it('shares one wait across a burst that arrives before the connection', async () => {
      // Each wait attaches `ready` and `error` listeners, and Node warns past
      // ten - so a burst at startup, which is exactly when the socket is still
      // opening, would print MaxListenersExceededWarning to stderr. That is
      // the noise this change exists to remove, reintroduced by the fix for
      // it. Asserted on the process warning itself rather than on a listener
      // count, because the warning is the thing that would land in CI.
      const client = coldClient(connectionUrl());
      const warnings: string[] = [];
      const onWarning = (warning: Error): void => {
        warnings.push(warning.name);
      };
      process.on('warning', onWarning);

      try {
        const bucket = new RedisTokenBucket(client);

        const decisions = await Promise.all(Array.from({length: 30}, async () => await bucket.consume(key(), frozen)));

        expect(decisions.every((decision) => decision.allowed)).toBe(true);
        expect(warnings).not.toContain('MaxListenersExceededWarning');
      } finally {
        process.off('warning', onWarning);
        await client.quit().catch(() => {
          client.disconnect();
        });
      }
    });

    it('waits again after the connection has been re-established', async () => {
      // The shared wait is cleared on settlement rather than memoised. Held,
      // a client that dropped and reconnected would keep answering from a
      // promise that resolved against a socket it no longer has.
      const client = coldClient(connectionUrl());
      try {
        await new RedisTokenBucket(client).consume(key(), frozen);
        expect(client.status).toBe('ready');

        const decision = await new RedisTokenBucket(client).consume(key(), frozen);

        expect(decision.allowed).toBe(true);
      } finally {
        await client.quit().catch(() => {
          client.disconnect();
        });
      }
    });

    it('gives up on a refused connection rather than waiting it out', async () => {
      // The other half: waiting must not turn an outage into a hang. The
      // fallback limiter degrades on a rejection, and it can only do that if
      // one arrives.
      const client = coldClient('redis://127.0.0.1:1');
      try {
        const startedAt = Date.now();

        await expect(new RedisTokenBucket(client).consume(key(), frozen)).rejects.toThrow(Error);

        expect(Date.now() - startedAt).toBeLessThan(READY_TIMEOUT_MS);
      } finally {
        client.disconnect();
      }
    });

    it('fails immediately once the client has been closed for good', async () => {
      // `end` is terminal, so waiting for `ready` could only ever time out.
      //
      // The wait for the event matters: `disconnect()` does not reach `end`
      // synchronously - called while connecting, the status is still
      // `connecting` on the next line and only settles a tick later. A spec
      // that asserted straight after it would be asserting about a client
      // that had not closed yet, and would have measured the timeout instead.
      const client = coldClient(connectionUrl());
      client.disconnect();
      await once(client, 'end');

      const startedAt = Date.now();

      await expect(new RedisTokenBucket(client).consume(key(), frozen)).rejects.toThrow(/closed/);

      expect(Date.now() - startedAt).toBeLessThan(READY_TIMEOUT_MS);
    });
  });
});
