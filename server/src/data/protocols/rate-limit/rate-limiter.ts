export type RateLimitDecision =
  | { allowed: true, remaining: number }
  | { allowed: false, retryAfterMs: number }

export type BucketConfig = {
  /** Requests available at once, from cold. */
  capacity: number
  /** Sustained rate. Expressed per hour because that is how the limits are reasoned about. */
  refillPerHour: number
}

/**
 * Names no transport concept on purpose: a key is a string, and whether it
 * came from an IP address or an email is the middleware's business.
 */
export interface RateLimiter {
  consume: (key: string, bucket: BucketConfig, cost?: number) => Promise<RateLimitDecision>
  /** Returns tokens taken for a request that was then rejected elsewhere. Never exceeds capacity. */
  refund: (key: string, bucket: BucketConfig, amount?: number) => Promise<void>
}
