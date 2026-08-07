import type {BucketConfig, RateLimitDecision, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';
import {makeRateLimitAllowance} from './rate-limit-allowance.js';

const MS_PER_HOUR = 3_600_000;
const DEFAULT_MAX_KEYS = 10_000;

type Bucket = {tokens: number; updated: number};

/**
 * The fallback for when Redis cannot answer. Per-instance, so with N API
 * instances the effective limit is N times the configured one - which is the
 * accepted cost of not making Redis a hard dependency for authentication.
 *
 * `Date.now()` is correct here precisely because the state never leaves this
 * process: the clock-skew problem that forces the Redis script to read TIME
 * does not exist inside one instance.
 */
export class MemoryTokenBucket implements RateLimiter {
  // Map preserves insertion order, which is what makes LRU a delete and a
  // re-set rather than a second data structure.
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
      // Not `(cost - tokens) / refillPerMs`: refillPerMs is itself already a
      // rounded division, and dividing by it a second time compounds that
      // rounding into a result a whole millisecond over the true value at
      // exact-boundary deficits (e.g. capacity 3, refillPerHour 1). Deriving
      // the deficit straight from refillPerHour keeps it to one division.
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

    // Capped, so a refund can never mint quota.
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
    // Delete first so a re-set moves the key to the end of the iteration
    // order, which is what makes the eviction below least-recently-used.
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
