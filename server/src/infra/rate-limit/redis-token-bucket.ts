import { once } from 'node:events'
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

/**
 * How long a command waits for the connection to come up before giving up.
 *
 * The client is built with `enableOfflineQueue: false`, which is what makes a
 * dead Redis reject rather than hang - but it draws no distinction between
 * dead and NOT YET CONNECTED. A socket takes a few milliseconds to become
 * writable, and until it does every command fails with "Stream isn't writeable
 * and enableOfflineQueue options is false". So the first request a process
 * served degraded to the in-process fallback for no reason beyond its own
 * timing, and every rate-limit decision for the next five seconds came from a
 * per-process bucket instead of the shared one.
 *
 * ioredis offers unbounded queueing or none. This is the middle: queue
 * briefly, then fail. A second is far longer than a connection needs and short
 * enough that a real outage is still noticed promptly - and an outage costs
 * one wait per degraded window rather than one per request, because the first
 * failure puts the limiter on its fallback for the next five seconds.
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

    if (allowed === 1) return { allowed: true, remaining }
    return { allowed: false, retryAfterMs }
  }

  async refund (key: string, bucket: BucketConfig, amount = 1): Promise<void> {
    await this.run(key, bucket, -amount)
  }

  /**
   * One wait shared by every request that arrives while the socket is opening.
   *
   * Coalesced for the same reason `CoalescingDnsResolver` is, plus one this
   * class cannot avoid: each wait attaches `ready` and `error` listeners to the
   * client, and Node warns past ten. A burst arriving at startup - which is
   * precisely when a connection is still opening - would print
   * MaxListenersExceededWarning to stderr, which is the noise this whole change
   * exists to remove.
   *
   * Cleared on settlement, so a later disconnect gets a fresh wait rather than
   * a memo of the last one.
   */
  private connecting: Promise<void> | null = null

  /**
   * Waits for a connection that is on its way, and only for that.
   *
   * `end` is terminal - the client has been closed and will never emit
   * `ready` - so it fails immediately rather than spending the timeout
   * learning that. Everything else is either already usable or connecting.
   *
   * `once` rejects on an `error` from the client as well as on the timeout,
   * which is what keeps a refused connection fast: there is no reason to wait
   * out the full budget for a socket that has already been told no.
   *
   * A client that closes WHILE this waits is not caught by either and costs
   * the full budget. Left alone: it needs a shutdown to land inside the
   * window, and a second of latency on the way out is not worth racing two
   * listeners to avoid.
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
