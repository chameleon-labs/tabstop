import { describe, expect, it } from 'vitest'
import {
  JITTER_WINDOW_MS, SAME_DOMAIN_STAGGER_MS, reauditDelayMs, utcDay, utcDayStart
} from './reaudit-schedule.js'

const domains = (count: number): string[] =>
  Array.from({ length: count }, (_value, index) => `site-${index}.example.test`)

describe('reauditDelayMs', () => {
  it('gives one domain the same slot every night', () => {
    // The property random jitter cannot have, and the reason this is a hash
    // rather than Math.random: a trend line whose measurement hour wanders
    // compares Monday morning against Tuesday evening.
    expect(reauditDelayMs('example.test', 0)).toBe(reauditDelayMs('example.test', 0))
  })

  it('gives different domains different slots', () => {
    const slots = new Set(domains(200).map((domain) => reauditDelayMs(domain, 0)))

    // Collisions are possible and harmless - two domains sharing a minute is
    // not the failure this guards against. A hash that mapped everything onto
    // one value is.
    expect(slots.size).toBeGreaterThan(190)
  })

  it('stays inside the window', () => {
    for (const domain of domains(500)) {
      const delay = reauditDelayMs(domain, 0)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThan(JITTER_WINDOW_MS)
    }
  })

  it('spreads across the whole window rather than favouring part of it', () => {
    // A hash that is deterministic but clustered would pass every assertion
    // above and still deliver the night's work in a spike - which is half of
    // what this function exists to prevent.
    const buckets = new Set(
      domains(2000).map((domain) => Math.floor(reauditDelayMs(domain, 0) / (10 * 60 * 1000)))
    )

    // 36 ten-minute buckets in six hours.
    expect(buckets.size).toBe(36)
  })

  it('separates pages that share a domain', () => {
    const first = reauditDelayMs('example.test', 0)
    const second = reauditDelayMs('example.test', 1)

    expect(second - first).toBe(SAME_DOMAIN_STAGGER_MS)
  })

  it('keeps wrapping rather than clamping once a domain has more pages than slots', () => {
    // The window holds 360 one-minute slots. Clamping at the edge would put
    // every page past it on the same instant - the simultaneous arrival at one
    // origin that the stagger exists to prevent, reappearing exactly for the
    // domain that tracks the most pages.
    const slots = new Set(
      Array.from({ length: 400 }, (_value, index) => reauditDelayMs('example.test', index))
    )

    expect(slots.size).toBe(360)
    for (const slot of slots) expect(slot).toBeLessThan(JITTER_WINDOW_MS)
  })

  it('honours a caller that narrows the window', () => {
    const delays = Array.from(
      { length: 50 },
      (_value, index) => reauditDelayMs(`d-${index}.test`, 0, 60_000, 1000)
    )

    for (const delay of delays) expect(delay).toBeLessThan(60_000)
  })
})

describe('utcDay', () => {
  it('reads the UTC calendar day', () => {
    expect(utcDay(new Date('2026-08-01T02:00:00Z'))).toBe('2026-08-01')
  })

  it('does not roll over on an instant that is already tomorrow somewhere else', () => {
    // 23:30 UTC is the next day in Sydney. A local-day reading here would
    // stamp the run with a date the constraint is not deduping on.
    expect(utcDay(new Date('2026-08-01T23:30:00Z'))).toBe('2026-08-01')
  })
})

describe('utcDayStart', () => {
  it('floors to midnight UTC', () => {
    expect(utcDayStart(new Date('2026-08-01T02:34:56.789Z')).toISOString())
      .toBe('2026-08-01T00:00:00.000Z')
  })

  it('is already midnight for midnight', () => {
    expect(utcDayStart(new Date('2026-08-01T00:00:00.000Z')).toISOString())
      .toBe('2026-08-01T00:00:00.000Z')
  })
})
