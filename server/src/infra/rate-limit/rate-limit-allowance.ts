import type { RateLimitAllowance } from '../../data/protocols/rate-limit/rate-limiter.js'

export const makeRateLimitAllowance = (
  remaining: number,
  refund: () => Promise<void>
): RateLimitAllowance => {
  let refundResult: Promise<void> | undefined

  return {
    allowed: true,
    remaining,
    refund: async () => await (refundResult ??= refund())
  }
}
