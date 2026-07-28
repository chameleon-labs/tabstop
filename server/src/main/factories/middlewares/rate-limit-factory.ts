import { Redis } from 'ioredis'
import { env } from '../../config/env.js'
import { FallbackRateLimiter } from '../../decorators/fallback-rate-limiter.js'
import { MemoryTokenBucket } from '../../../infra/rate-limit/memory-token-bucket.js'
import { RedisTokenBucket } from '../../../infra/rate-limit/redis-token-bucket.js'
import type { RateLimiter } from '../../../data/protocols/rate-limit/rate-limiter.js'

/** Bounds how long a request waits on a limiter that is not answering. */
const COMMAND_TIMEOUT_MS = 250

let limiter: RateLimiter | null = null
// Held separately from `limiter` because closing needs the raw client -
// FallbackRateLimiter and RedisTokenBucket expose no way to reach back into
// the connection they were built with.
let redisClient: Redis | null = null

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

    redisClient = redis
    limiter = new FallbackRateLimiter(new RedisTokenBucket(redis), new MemoryTokenBucket())
  }
  return limiter
}

/**
 * Without this, the memoised client is never disposed. ioredis retries a
 * lost connection forever by default, so nothing ends it on its own -
 * app.spec.ts's vi.resetModules() churn mints a fresh client on every
 * re-import of ./app.js and quits none of them, and the process itself has
 * no equivalent of disconnectDatabase() to call from its own shutdown path.
 */
export const closeRateLimiter = async (): Promise<void> => {
  if (redisClient === null) return

  try {
    // Graceful: waits for in-flight replies before closing the socket.
    await redisClient.quit()
  } catch {
    // quit() sends a command, and `enableOfflineQueue: false` makes that
    // throw if the client was still connecting (or already failed) rather
    // than ready - e.g. a rate limiter that was built but never actually
    // used before shutdown, which is normal in a test that never sends a
    // request through it. disconnect() tears down the socket unconditionally
    // instead of sending anything, so it works from every connection state.
    redisClient.disconnect()
  }
  redisClient = null
  limiter = null
}
