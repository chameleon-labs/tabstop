export type RateLimitAllowance = {
  allowed: true;
  remaining: number;
  refund: () => Promise<void>;
};

export type RateLimitDecision = RateLimitAllowance | {allowed: false; retryAfterMs: number};

export type BucketConfig = {
  /** Requests available at once, from cold. */
  capacity: number;
  /**
   * Sustained rate. Expressed per hour because that is how the limits are
   * reasoned about. Must be greater than zero - it divides both the wait and
   * TTL arithmetic in every implementation of this protocol.
   */
  refillPerHour: number;
};

/**
 * Names no transport concept on purpose: a key is a string, and whether it
 * came from an IP address or an email is the middleware's business.
 */
export interface RateLimiter {
  consume: (key: string, bucket: BucketConfig, cost?: number) => Promise<RateLimitDecision>;
}
