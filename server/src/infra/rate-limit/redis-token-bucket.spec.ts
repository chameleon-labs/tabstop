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

const fast: BucketConfig = {capacity: 3, refillPerHour: 36_000};
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

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1_100);
  });

  it('expires an idle bucket rather than keeping a key per caller forever', async () => {
    const k = key();
    await sut.consume(k, fast);

    const ttl = await redis.pttl(`rl:${k}`);

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1_100);
  });

  it('does not overshoot the wait by a millisecond at an exact-boundary deficit', async () => {
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
    const coldClient = (url: string): Redis => {
      const client = new Redis(url, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        commandTimeout: 250,
      });
      client.on('error', () => {});
      return client;
    };

    it('serves a command issued before the socket is writable', async () => {
      const client = coldClient(connectionUrl());
      try {
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
      const client = coldClient(connectionUrl());
      client.disconnect();
      await once(client, 'end');

      const startedAt = Date.now();

      await expect(new RedisTokenBucket(client).consume(key(), frozen)).rejects.toThrow(/closed/);

      expect(Date.now() - startedAt).toBeLessThan(READY_TIMEOUT_MS);
    });
  });
});
