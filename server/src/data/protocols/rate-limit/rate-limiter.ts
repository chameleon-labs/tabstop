export type RateLimitAllowance = {
  allowed: true;
  remaining: number;
  refund: () => Promise<void>;
};

export type RateLimitDecision = RateLimitAllowance | {allowed: false; retryAfterMs: number};

export type BucketConfig = {
  capacity: number;
  refillPerHour: number;
};

export interface RateLimiter {
  consume: (key: string, bucket: BucketConfig, cost?: number) => Promise<RateLimitDecision>;
}
