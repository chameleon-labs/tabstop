import {Redis} from 'ioredis';
import {env} from '../../config/env.js';
import {FallbackRateLimiter} from '../../decorators/fallback-rate-limiter.js';
import {MemoryTokenBucket} from '../../../infra/rate-limit/memory-token-bucket.js';
import {RedisTokenBucket} from '../../../infra/rate-limit/redis-token-bucket.js';
import type {RateLimiter} from '../../../data/protocols/rate-limit/rate-limiter.js';

const COMMAND_TIMEOUT_MS = 250;

let limiter: RateLimiter | null = null;
let redisClient: Redis | null = null;

export const makeRateLimiter = (): RateLimiter => {
  if (limiter === null) {
    const redis = new Redis(env.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: COMMAND_TIMEOUT_MS,
    });

    redis.on('error', (error) => {
      console.error('Rate limiter Redis error:', error);
    });

    redisClient = redis;
    limiter = new FallbackRateLimiter(new RedisTokenBucket(redis), new MemoryTokenBucket());
  }
  return limiter;
};

export const closeRateLimiter = async (): Promise<void> => {
  if (redisClient === null) {
    return;
  }

  try {
    await redisClient.quit();
  } catch {
    redisClient.disconnect();
  }
  redisClient = null;
  limiter = null;
};
