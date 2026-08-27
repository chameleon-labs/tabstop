import {randomUUID} from 'node:crypto';
import {Redis} from 'ioredis';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {MemoryTokenBucket} from './memory-token-bucket.js';
import {RedisTokenBucket} from './redis-token-bucket.js';
import type {BucketConfig, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';

const frozen: BucketConfig = {capacity: 3, refillPerHour: 1};
const oneFrozen: BucketConfig = {capacity: 1, refillPerHour: 1};
const fast: BucketConfig = {capacity: 3, refillPerHour: 36_000};

let redis: Redis;

beforeAll(() => {
  const url = process.env.REDIS_URL;
  if (url === undefined) {
    throw new Error('REDIS_URL not set by globalSetup');
  }
  redis = new Redis(url);
});

afterAll(async () => {
  await redis.quit();
});

describe.each<[string, () => RateLimiter]>([
  ['RedisTokenBucket', () => new RedisTokenBucket(redis)],
  ['MemoryTokenBucket', () => new MemoryTokenBucket()],
])('%s as a RateLimiter', (_name, make) => {
  const key = (): string => `contract-${randomUUID()}`;

  it('allows exactly the capacity from cold, then rejects', async () => {
    const sut = make();
    const k = key();

    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await sut.consume(k, frozen));
    }

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
  });

  it('counts down the remaining tokens', async () => {
    const sut = make();
    const k = key();

    const first = await sut.consume(k, frozen);
    const second = await sut.consume(k, frozen);

    expect(first).toMatchObject({allowed: true, remaining: 2});
    expect(second).toMatchObject({allowed: true, remaining: 1});
  });

  it('reports a wait scaled to the deficit rather than a constant', async () => {
    const sut = make();
    const k = key();
    for (let i = 0; i < 3; i++) {
      await sut.consume(k, frozen);
    }

    const denied = await sut.consume(k, frozen);

    if (denied.allowed) {
      throw new Error('expected the bucket to be empty');
    }
    expect(denied.retryAfterMs).toBeGreaterThan(3_000_000);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(3_600_000);
  });

  it('scales the wait with the refill rate, not a constant', async () => {
    const quadRefill: BucketConfig = {capacity: 3, refillPerHour: 4};
    const sut = make();
    const slowKey = key();
    const fastKey = key();
    for (let i = 0; i < 3; i++) {
      await sut.consume(slowKey, frozen);
    }
    for (let i = 0; i < 3; i++) {
      await sut.consume(fastKey, quadRefill);
    }

    const slowDenied = await sut.consume(slowKey, frozen);
    const fastDenied = await sut.consume(fastKey, quadRefill);

    if (slowDenied.allowed || fastDenied.allowed) {
      throw new Error('expected both buckets to be empty');
    }
    const ratio = slowDenied.retryAfterMs / fastDenied.retryAfterMs;
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4.5);
  });

  it('refills over elapsed time', async () => {
    const sut = make();
    const k = key();
    for (let i = 0; i < 3; i++) {
      await sut.consume(k, fast);
    }
    expect((await sut.consume(k, fast)).allowed).toBe(false);

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });

    expect((await sut.consume(k, fast)).allowed).toBe(true);
  });

  it('keeps buckets separate per key', async () => {
    const sut = make();
    const exhausted = key();
    for (let i = 0; i < 3; i++) {
      await sut.consume(exhausted, frozen);
    }

    expect((await sut.consume(key(), frozen)).allowed).toBe(true);
  });

  it('returns a token on refund', async () => {
    const sut = make();
    const k = key();
    const first = await sut.consume(k, frozen);
    if (!first.allowed) {
      throw new Error('expected allowance');
    }
    for (let i = 0; i < 2; i++) {
      await sut.consume(k, frozen);
    }

    await first.refund();

    expect((await sut.consume(k, frozen)).allowed).toBe(true);
  });

  it('refunds an allowance at most once', async () => {
    const sut = make();
    const k = key();
    const first = await sut.consume(k, oneFrozen);
    if (!first.allowed) {
      throw new Error('expected allowance');
    }

    await first.refund();
    expect((await sut.consume(k, oneFrozen)).allowed).toBe(true);

    await first.refund();
    expect((await sut.consume(k, oneFrozen)).allowed).toBe(false);
  });
});
