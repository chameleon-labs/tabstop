import type {RateLimitedBody} from '@tabstop/contract';

export const toRateLimitedBody = (retryAfterSeconds: number, now: Date): RateLimitedBody => ({
  error: 'Too many requests',
  retryAfter: retryAfterSeconds,
  resetAt: new Date(now.getTime() + retryAfterSeconds * 1000).toISOString(),
});
