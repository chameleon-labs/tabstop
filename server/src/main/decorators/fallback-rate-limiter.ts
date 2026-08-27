import type {BucketConfig, RateLimitDecision, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';

const LOG_INTERVAL_MS = 30_000;

const DEGRADED_WINDOW_MS = 5_000;

export class FallbackRateLimiter implements RateLimiter {
  private lastLoggedAt = 0;
  private degradedUntil = 0;

  constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter,
  ) {}

  async consume(key: string, bucket: BucketConfig, cost = 1): Promise<RateLimitDecision> {
    if (this.degraded()) {
      return await this.fallback.consume(key, bucket, cost);
    }

    try {
      return await this.primary.consume(key, bucket, cost);
    } catch (error) {
      this.degrade(error);
      return await this.fallback.consume(key, bucket, cost);
    }
  }

  private degraded(): boolean {
    return Date.now() < this.degradedUntil;
  }

  private degrade(error: unknown): void {
    this.degradedUntil = Date.now() + DEGRADED_WINDOW_MS;
    this.report(error);
  }

  private report(error: unknown): void {
    const now = Date.now();
    if (now - this.lastLoggedAt < LOG_INTERVAL_MS) {
      return;
    }

    this.lastLoggedAt = now;
    console.warn('Rate limiter falling back to in-process buckets:', error);
  }
}
