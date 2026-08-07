import {describe, expect, it} from 'vitest';
import {JITTER_WINDOW_MS, SAME_DOMAIN_STAGGER_MS, reauditDelayMs, utcDay, utcDayStart} from './reaudit-schedule.js';

const domains = (count: number): string[] =>
  Array.from({length: count}, (_value, index) => `site-${index}.example.test`);

const pageIds = (count: number): string[] => Array.from({length: count}, (_value, index) => String(1000 + index));

describe('reauditDelayMs', () => {
  it('gives one page the same slot every night', () => {
    // The property random jitter cannot have, and the reason this is a hash
    // rather than Math.random: a trend line whose measurement hour wanders
    // compares Monday morning against Tuesday evening.
    expect(reauditDelayMs('example.test', '42')).toBe(reauditDelayMs('example.test', '42'));
  });

  it('depends on nothing but the page and its domain', () => {
    // The bug this replaced: the offset used to be the page's INDEX among the
    // pages a run happened to hold for its domain. That is not a property of
    // the page - it moves when a sibling is paused or is still mid-audit, and
    // a retry sees a different set again - so the "same slot every night"
    // above held only for domains tracking exactly one page.
    const first = reauditDelayMs('example.test', '1001');
    const second = reauditDelayMs('example.test', '1002');

    // Whichever order they arrive in, and whatever else is due alongside them.
    expect(reauditDelayMs('example.test', '1002')).toBe(second);
    expect(reauditDelayMs('example.test', '1001')).toBe(first);
  });

  it('gives different domains different slots', () => {
    const slots = new Set(domains(200).map((domain) => reauditDelayMs(domain, '1')));

    // Collisions are possible and harmless - two domains sharing a minute is
    // not the failure this guards against. A hash that mapped everything onto
    // one value is.
    expect(slots.size).toBeGreaterThan(190);
  });

  it('separates pages that share a domain', () => {
    // Probabilistically now rather than by construction, which is the cost of
    // dropping positions - and NOT because a collision is harmless. At
    // AUDIT_CONCURRENCY above one, which is a supported setting up to 16, two
    // pages in one slot really can reach the same host together.
    //
    // It is acceptable because this function was never what guaranteed
    // otherwise. Spreading the night's work and holding each page at a
    // consistent hour is its job; making sure two audits of one host never
    // overlap is #41's, at the worker - which is where it has to be, since a
    // delay can only separate jobs that start on time.
    const slots = new Set(pageIds(20).map((pageId) => reauditDelayMs('example.test', pageId)));

    expect(slots.size).toBeGreaterThan(17);
  });

  it('stays inside the window', () => {
    for (const domain of domains(500)) {
      const delay = reauditDelayMs(domain, '7');
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(JITTER_WINDOW_MS);
    }
    for (const pageId of pageIds(500)) {
      const delay = reauditDelayMs('example.test', pageId);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(JITTER_WINDOW_MS);
    }
  });

  it('spreads across the whole window rather than favouring part of it', () => {
    // A hash that is deterministic but clustered would pass every assertion
    // above and still deliver the night's work in a spike - which is half of
    // what this function exists to prevent.
    const buckets = new Set(domains(2000).map((domain) => Math.floor(reauditDelayMs(domain, '1') / (10 * 60 * 1000))));

    // 36 ten-minute buckets in six hours.
    expect(buckets.size).toBe(36);
  });

  it("spreads one domain's pages across the window too", () => {
    // The stagger has to reach the whole window rather than crowding the
    // domain's base offset, or an account tracking many pages hands its own
    // origin a burst.
    const buckets = new Set(
      pageIds(2000).map((pageId) => Math.floor(reauditDelayMs('example.test', pageId) / (10 * 60 * 1000))),
    );

    expect(buckets.size).toBe(36);
  });

  it('lands every page on a stagger boundary relative to its domain', () => {
    // What keeps same-domain pages a whole minute apart when they differ at
    // all, rather than milliseconds apart.
    const base = reauditDelayMs('example.test', '0');
    for (const pageId of pageIds(200)) {
      const offset = (reauditDelayMs('example.test', pageId) - base + JITTER_WINDOW_MS) % JITTER_WINDOW_MS;
      expect(offset % SAME_DOMAIN_STAGGER_MS).toBe(0);
    }
  });

  it('honours a caller that narrows the window', () => {
    const delays = pageIds(50).map((pageId) => reauditDelayMs('example.test', pageId, 60_000, 1000));

    for (const delay of delays) expect(delay).toBeLessThan(60_000);
  });

  it('survives a window narrower than one stagger step', () => {
    // Would divide by zero without a floor of one slot, and a schedule that
    // throws on an odd configuration fails at boot rather than degrading.
    expect(reauditDelayMs('example.test', '42', 1000, 60_000)).toBeLessThan(1000);
  });
});

describe('utcDay', () => {
  it('reads the UTC calendar day', () => {
    expect(utcDay(new Date('2026-08-01T02:00:00Z'))).toBe('2026-08-01');
  });

  it('does not roll over on an instant that is already tomorrow somewhere else', () => {
    // 23:30 UTC is the next day in Sydney. A local-day reading here would
    // stamp the run with a date the constraint is not deduping on.
    expect(utcDay(new Date('2026-08-01T23:30:00Z'))).toBe('2026-08-01');
  });
});

describe('utcDayStart', () => {
  it('floors to midnight UTC', () => {
    expect(utcDayStart(new Date('2026-08-01T02:34:56.789Z')).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('is already midnight for midnight', () => {
    expect(utcDayStart(new Date('2026-08-01T00:00:00.000Z')).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
});
