import type {BucketConfig, RateLimitDecision, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';

/** An outage that logged per request would do more damage than the outage. */
const LOG_INTERVAL_MS = 30_000;

/**
 * How long one failure keeps traffic on the fallback before the primary is
 * tried again.
 *
 * It avoids paying a dead Redis command timeout on every request and accepts
 * up to five seconds of per-process counting after recovery. It no longer
 * provides refund consistency; the allowance capability does.
 */
const DEGRADED_WINDOW_MS = 5_000;

/**
 * Tries the shared limiter and degrades to a local one when it cannot answer.
 *
 * The alternative - refusing the request - was rejected: it would hand an
 * attacker who can make Redis flaky a complete authentication outage, and it
 * would make the queue's health a hard dependency of logging in.
 */
export class FallbackRateLimiter implements RateLimiter {
  private lastLoggedAt = 0;
  private degradedUntil = 0;

  constructor(
    private readonly primary: RateLimiter,
    private readonly fallback: RateLimiter,
  ) {}

  async consume(key: string, bucket: BucketConfig, cost = 1): Promise<RateLimitDecision> {
    if (this.degraded()) return await this.fallback.consume(key, bucket, cost);

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
    if (now - this.lastLoggedAt < LOG_INTERVAL_MS) return;

    this.lastLoggedAt = now;
    console.warn('Rate limiter falling back to in-process buckets:', error);
  }
}
