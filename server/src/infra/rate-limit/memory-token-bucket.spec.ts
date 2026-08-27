import {describe, expect, it, vi} from 'vitest';
import {MemoryTokenBucket} from './memory-token-bucket.js';
import type {BucketConfig} from '../../data/protocols/rate-limit/rate-limiter.js';

const frozen: BucketConfig = {capacity: 3, refillPerHour: 1};

describe('MemoryTokenBucket', () => {
  it('caps a refunded allowance after its original bucket has refilled', async () => {
    vi.useFakeTimers();
    try {
      const sut = new MemoryTokenBucket();
      const wide: BucketConfig = {capacity: 10, refillPerHour: 1};

      const allowance = await sut.consume('a', frozen);
      if (!allowance.allowed) {
        throw new Error('expected allowance');
      }
      vi.advanceTimersByTime(3_600_000);
      await allowance.refund();

      expect(await sut.consume('a', wide)).toMatchObject({allowed: true, remaining: 2});
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts rather than growing without bound', async () => {
    const sut = new MemoryTokenBucket(2);

    await sut.consume('a', frozen);
    await sut.consume('b', frozen);
    await sut.consume('c', frozen);

    expect(sut.size).toBe(2);
  });

  it('evicts the least recently used key', async () => {
    const sut = new MemoryTokenBucket(2);
    for (let i = 0; i < 3; i++) {
      await sut.consume('a', frozen);
    }
    await sut.consume('b', frozen);
    await sut.consume('a', frozen);

    await sut.consume('c', frozen);

    expect((await sut.consume('a', frozen)).allowed).toBe(false);
    expect((await sut.consume('b', frozen)).allowed).toBe(true);
  });
});
