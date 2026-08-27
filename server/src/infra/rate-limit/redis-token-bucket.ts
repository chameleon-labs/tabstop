import {once} from 'node:events';
import type {Redis} from 'ioredis';
import type {BucketConfig, RateLimitDecision, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';
import {makeRateLimitAllowance} from './rate-limit-allowance.js';

const MS_PER_HOUR = 3_600_000;

export const WAIT_MS_FORMULA = '(cost - tokens) * msPerHour / refillPerHour';

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
`;

export const READY_TIMEOUT_MS = 1000;

export class RedisTokenBucket implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix = 'rl',
    private readonly readyTimeoutMs = READY_TIMEOUT_MS,
  ) {}

  async consume(key: string, bucket: BucketConfig, cost = 1): Promise<RateLimitDecision> {
    const [allowed, remaining, retryAfterMs] = await this.run(key, bucket, cost);

    if (allowed === 1) {
      return makeRateLimitAllowance(remaining, async () => {
        await this.run(key, bucket, -cost);
      });
    }
    return {allowed: false, retryAfterMs};
  }

  private connecting: Promise<void> | null = null;

  private async awaitConnection(): Promise<void> {
    if (this.redis.status === 'ready') {
      return;
    }
    if (this.redis.status === 'end') {
      throw new Error('Rate limiter connection is closed');
    }

    this.connecting ??= this.waitForReady();

    await this.connecting;
  }

  private async waitForReady(): Promise<void> {
    try {
      await once(this.redis, 'ready', {signal: AbortSignal.timeout(this.readyTimeoutMs)});
    } finally {
      this.connecting = null;
    }
  }

  private async run(key: string, bucket: BucketConfig, cost: number): Promise<[number, number, number]> {
    await this.awaitConnection();

    const result = await this.redis.eval(
      SCRIPT,
      1,
      `${this.keyPrefix}:${key}`,
      bucket.capacity,
      bucket.refillPerHour / MS_PER_HOUR,
      cost,
      bucket.refillPerHour,
    );

    if (!Array.isArray(result) || result.length !== 3) {
      throw new Error('Rate limit script returned an unexpected shape');
    }
    return result.map(Number) as [number, number, number];
  }
}
