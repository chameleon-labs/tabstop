import { once } from 'node:events'
import type { Redis } from 'ioredis'
import type {
  BucketConfig, RateLimitDecision, RateLimiter
} from '../../data/protocols/rate-limit/rate-limiter.js'
import { makeRateLimitAllowance } from './rate-limit-allowance.js'

const MS_PER_HOUR = 3_600_000

/**
 * Not `(cost - tokens) / refillPerMs`: `refillPerMs` is already a rounded
 * division, and dividing by it again compounds that into a result a whole
 * millisecond over the true value at exact-boundary deficits -
 * `1 / (1 / 3600000) === 3600000.0000000005`, and Lua uses the same doubles.
 *
 * Exported verbatim so the spec can eval this exact expression against a real
 * Lua interpreter: landing SCRIPT's own `tokens` on precisely `cost - 1` would
 * mean racing Redis's TIME(), so the boundary is checked here instead and the
 * shared string keeps the two from diverging.
 */
export const WAIT_MS_FORMULA = '(cost - tokens) * msPerHour / refillPerHour'

/**
 * Check and consume in one round trip. Read-then-write from Node is not
 * equivalent: two concurrent requests both see the last token and both
 * proceed, which a spec fires twenty parallel consumes to prove.
 *
 * `now` comes from Redis: with more than one API instance (#16) the app clocks
 * drift, and a shared bucket would refill at whichever ran fast. Redis 7+
 * replicates by effects, so calling TIME then writing is permitted.
 */
const SCRIPT = `
local msPerHour     = ${MS_PER_HOUR}
local capacity      = tonumber(ARGV[1])
local refillPerMs   = tonumber(ARGV[2])
local cost          = tonumber(ARGV[3])
local refillPerHour = tonumber(ARGV[4])

local time = redis.call('TIME')
local now  = time[1] * 1000 + math.floor(time[2] / 1000)

local state   = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local tokens  = tonumber(state[1])
local updated = tonumber(state[2])

if tokens == nil or updated == nil then
  tokens  = capacity
  updated = now
end

tokens = math.min(capacity, tokens + (now - updated) * refillPerMs)

-- A refund is a negative cost. Capping AFTER the adjustment is what keeps a
-- refund from pushing the bucket above capacity and minting free tokens.
local allowed = tokens >= cost
if allowed then tokens = math.min(capacity, tokens - cost) end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'updated', now)
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity - tokens) / refillPerMs) + 1000)

if allowed then return { 1, math.floor(tokens), 0 } end
return { 0, math.floor(tokens), math.ceil(${WAIT_MS_FORMULA}) }
`

/**
 * How long a command waits for the connection to come up before giving up.
 *
 * `enableOfflineQueue: false` is what makes a dead Redis reject rather than
 * hang, but it does not distinguish dead from NOT YET CONNECTED - so until the
 * socket became writable, the first request a process served degraded to the
 * in-process fallback purely on its own timing, taking the next five seconds
 * of decisions with it.
 *
 * ioredis offers unbounded queueing or none; this is the middle. A second is
 * far longer than a connection needs and short enough to notice a real outage,
 * which costs one wait per degraded window rather than one per request.
 */
export const READY_TIMEOUT_MS = 1000

export class RedisTokenBucket implements RateLimiter {
  constructor (
    private readonly redis: Redis,
    private readonly keyPrefix = 'rl',
    private readonly readyTimeoutMs = READY_TIMEOUT_MS
  ) {}

  async consume (key: string, bucket: BucketConfig, cost = 1): Promise<RateLimitDecision> {
    const [allowed, remaining, retryAfterMs] = await this.run(key, bucket, cost)

    if (allowed === 1) {
      return makeRateLimitAllowance(remaining, async () => {
        await this.run(key, bucket, -cost)
      })
    }
    return { allowed: false, retryAfterMs }
  }

  /**
   * One wait shared by every request arriving while the socket is opening.
   *
   * Each wait attaches `ready` and `error` listeners and Node warns past ten,
   * so a burst at startup - precisely when a connection is still opening -
   * would print MaxListenersExceededWarning to stderr.
   *
   * Cleared on settlement, so a later disconnect gets a fresh wait.
   */
  private connecting: Promise<void> | null = null

  /**
   * Waits for a connection that is on its way, and only for that.
   *
   * `end` is terminal, so it fails immediately rather than spending the
   * timeout learning that; everything else is usable or connecting. `once`
   * rejects on `error` too, so a refused socket does not wait out the budget.
   *
   * A client that closes WHILE this waits is caught by neither and costs the
   * full budget - left alone, since it needs a shutdown to land inside the
   * window and a second on the way out is not worth racing listeners over.
   */
  private async awaitConnection (): Promise<void> {
    if (this.redis.status === 'ready') return
    if (this.redis.status === 'end') {
      throw new Error('Rate limiter connection is closed')
    }

    this.connecting ??= this.waitForReady()

    await this.connecting
  }

  private async waitForReady (): Promise<void> {
    try {
      await once(this.redis, 'ready', { signal: AbortSignal.timeout(this.readyTimeoutMs) })
    } finally {
      // On success as well as failure: the next burst after a dropped
      // connection has to wait for its own `ready`, not remember this one.
      this.connecting = null
    }
  }

  private async run (
    key: string, bucket: BucketConfig, cost: number
  ): Promise<[number, number, number]> {
    // Before the command, not around it. A rejection here is indistinguishable
    // to the caller from any other failure to reach Redis, which is what the
    // fallback limiter above already knows how to handle.
    await this.awaitConnection()

    const result = await this.redis.eval(
      SCRIPT, 1, `${this.keyPrefix}:${key}`,
      bucket.capacity, bucket.refillPerHour / MS_PER_HOUR, cost, bucket.refillPerHour
    )

    // eval is typed `unknown`; the script's own return shape is the contract.
    if (!Array.isArray(result) || result.length !== 3) {
      throw new Error('Rate limit script returned an unexpected shape')
    }
    return result.map(Number) as [number, number, number]
  }
}
