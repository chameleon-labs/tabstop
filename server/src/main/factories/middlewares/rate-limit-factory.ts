import { Redis } from 'ioredis'
import { env } from '../../config/env.js'
import { FallbackRateLimiter } from '../../decorators/fallback-rate-limiter.js'
import { MemoryTokenBucket } from '../../../infra/rate-limit/memory-token-bucket.js'
import { RedisTokenBucket } from '../../../infra/rate-limit/redis-token-bucket.js'
import type { RateLimiter } from '../../../data/protocols/rate-limit/rate-limiter.js'

/** Bounds how long a request waits on a limiter that is not answering. */
const COMMAND_TIMEOUT_MS = 250

let limiter: RateLimiter | null = null

export const makeRateLimiter = (): RateLimiter => {
  if (limiter === null) {
    // These three options are what make the fallback reachable. ioredis
    // defaults queue commands while disconnected, so a dead Redis would not
    // reject - it would hang, and every request would simply get slower. #9
    // measured exactly that with BullMQ's queue: five minutes, no rejection.
    const redis = new Redis(env.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      commandTimeout: COMMAND_TIMEOUT_MS
    })

    // Without a listener an EventEmitter error is a process-level hazard, and
    // a connection error here is expected rather than exceptional.
    redis.on('error', (error) => {
      console.error('Rate limiter Redis error:', error)
    })

    limiter = new FallbackRateLimiter(new RedisTokenBucket(redis), new MemoryTokenBucket())
  }
  return limiter
}
