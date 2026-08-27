import type {BucketConfig, RateLimitDecision, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';
import {makeRateLimitAllowance} from './rate-limit-allowance.js';

const MS_PER_HOUR = 3_600_000;
const DEFAULT_MAX_KEYS = 10_000;

type Bucket = {tokens: number; updated: number};

export class MemoryTokenBucket implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly maxKeys = DEFAULT_MAX_KEYS) {}

  get size(): number {
    return this.buckets.size;
  }

  consume(key: string, bucket: BucketConfig, cost = 1): Promise<RateLimitDecision> {
    const refillPerMs = bucket.refillPerHour / MS_PER_HOUR;
    const tokens = this.refilled(key, bucket, refillPerMs);

    if (tokens < cost) {
      this.store(key, {tokens, updated: Date.now()});
      const retryAfterMs = ((cost - tokens) * MS_PER_HOUR) / bucket.refillPerHour;
      return Promise.resolve({allowed: false, retryAfterMs: Math.ceil(retryAfterMs)});
    }

    const remaining = Math.min(bucket.capacity, tokens - cost);
    this.store(key, {tokens: remaining, updated: Date.now()});
    return Promise.resolve(
      makeRateLimitAllowance(Math.floor(remaining), () => {
        this.returnTokens(key, bucket, cost);
        return Promise.resolve();
      }),
    );
  }

  private returnTokens(key: string, bucket: BucketConfig, amount: number): void {
    const refillPerMs = bucket.refillPerHour / MS_PER_HOUR;
    const tokens = this.refilled(key, bucket, refillPerMs);

    this.store(key, {tokens: Math.min(bucket.capacity, tokens + amount), updated: Date.now()});
  }

  private refilled(key: string, bucket: BucketConfig, refillPerMs: number): number {
    const existing = this.buckets.get(key);
    if (existing === undefined) {
      return bucket.capacity;
    }

    const elapsed = Date.now() - existing.updated;
    return Math.min(bucket.capacity, existing.tokens + elapsed * refillPerMs);
  }

  private store(key: string, bucket: Bucket): void {
    this.buckets.delete(key);
    this.buckets.set(key, bucket);

    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.buckets.delete(oldest.value);
    }
  }
}
