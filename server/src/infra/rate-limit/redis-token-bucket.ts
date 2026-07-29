import type { Redis } from 'ioredis'
import type {
  BucketConfig, RateLimitDecision, RateLimiter
} from '../../data/protocols/rate-limit/rate-limiter.js'

const MS_PER_HOUR = 3_600_000

/**
 * Not `(cost - tokens) / refillPerMs`: `refillPerMs` is itself already a
 * rounded division (`refillPerHour / msPerHour`), and dividing by it a second
 * time compounds that rounding into a result a whole millisecond over the
 * true value at exact-boundary deficits (e.g. capacity 3, refillPerHour 1, a
 * deficit of exactly 1 token - `1 / (1 / 3600000) === 3600000.0000000005` in
 * IEEE754, and Lua's numbers are the same doubles JS uses). Deriving the wait
 * straight from `refillPerHour` keeps it to one division instead of a
 * division of a division.
 *
 * Exported verbatim so `redis-token-bucket.spec.ts` can eval this exact
 * expression against a real Lua interpreter with controlled inputs: forcing
 * SCRIPT's own `tokens` to land at precisely `cost - 1` would mean racing
 * Redis's TIME() call, which cannot be done deterministically, so the
 * boundary is instead verified here, sharing this string so the production
 * formula and the spec can never silently diverge.
 */
export const WAIT_MS_FORMULA = '(cost - tokens) * msPerHour / refillPerHour'

/**
 * Check and consume in one round trip. Read-then-write from Node is not
 * equivalent: two concurrent requests both see the last token and both
 * proceed, which a spec fires twenty parallel consumes to prove.
 *
 * `now` comes from Redis rather than from Node. With more than one API
 * instance (#16) the app clocks drift, and a bucket shared between them would
 * refill at whichever instance's clock ran fast. Redis 7+ replicates scripts
 * by effects, so calling TIME and then writing is permitted.
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

export class RedisTokenBucket implements RateLimiter {
  constructor (
    private readonly redis: Redis,
    private readonly keyPrefix = 'rl'
  ) {}

  async consume (key: string, bucket: BucketConfig, cost = 1): Promise<RateLimitDecision> {
    const [allowed, remaining, retryAfterMs] = await this.run(key, bucket, cost)

    if (allowed === 1) return { allowed: true, remaining }
    return { allowed: false, retryAfterMs }
  }

  async refund (key: string, bucket: BucketConfig, amount = 1): Promise<void> {
    await this.run(key, bucket, -amount)
  }

  private async run (
    key: string, bucket: BucketConfig, cost: number
  ): Promise<[number, number, number]> {
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
