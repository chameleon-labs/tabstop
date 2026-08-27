import {describe, expect, it} from 'vitest';
import {
  JITTER_WINDOW_MS,
  REAUDIT_RUN_HOUR_UTC,
  SAME_DOMAIN_STAGGER_MS,
  nextReauditAt,
  reauditDelayMs,
  utcDay,
  utcDayStart,
  type ReauditSubject,
} from './reaudit-schedule.js';

const domains = (count: number): string[] =>
  Array.from({length: count}, (_value, index) => `site-${index}.example.test`);

const pageIds = (count: number): string[] => Array.from({length: count}, (_value, index) => String(1000 + index));

describe('reauditDelayMs', () => {
  it('gives one page the same slot every night', () => {
    expect(reauditDelayMs('example.test', '42')).toBe(reauditDelayMs('example.test', '42'));
  });

  it('depends on nothing but the page and its domain', () => {
    const first = reauditDelayMs('example.test', '1001');
    const second = reauditDelayMs('example.test', '1002');

    expect(reauditDelayMs('example.test', '1002')).toBe(second);
    expect(reauditDelayMs('example.test', '1001')).toBe(first);
  });

  it('gives different domains different slots', () => {
    const slots = new Set(domains(200).map((domain) => reauditDelayMs(domain, '1')));

    expect(slots.size).toBeGreaterThan(190);
  });

  it('separates pages that share a domain', () => {
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
    const buckets = new Set(domains(2000).map((domain) => Math.floor(reauditDelayMs(domain, '1') / (10 * 60 * 1000))));

    expect(buckets.size).toBe(36);
  });

  it("spreads one domain's pages across the window too", () => {
    const buckets = new Set(
      pageIds(2000).map((pageId) => Math.floor(reauditDelayMs('example.test', pageId) / (10 * 60 * 1000))),
    );

    expect(buckets.size).toBe(36);
  });

  it('lands every page on a stagger boundary relative to its domain', () => {
    const base = reauditDelayMs('example.test', '0');
    for (const pageId of pageIds(200)) {
      const offset = (reauditDelayMs('example.test', pageId) - base + JITTER_WINDOW_MS) % JITTER_WINDOW_MS;
      expect(offset % SAME_DOMAIN_STAGGER_MS).toBe(0);
    }
  });

  it('honours a caller that narrows the window', () => {
    const delays = pageIds(50).map((pageId) => reauditDelayMs('example.test', pageId, 60_000, 1000));

    for (const delay of delays) {
      expect(delay).toBeLessThan(60_000);
    }
  });

  it('survives a window narrower than one stagger step', () => {
    expect(reauditDelayMs('example.test', '42', 1000, 60_000)).toBeLessThan(1000);
  });
});

describe('utcDay', () => {
  it('reads the UTC calendar day', () => {
    expect(utcDay(new Date('2026-08-01T02:00:00Z'))).toBe('2026-08-01');
  });

  it('does not roll over on an instant that is already tomorrow somewhere else', () => {
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

describe('nextReauditAt', () => {
  const DOMAIN = 'acme.example';
  const PAGE = 'page-1';
  const slot = (day: string): Date =>
    new Date(
      new Date(`${day}T00:00:00.000Z`).getTime() + REAUDIT_RUN_HOUR_UTC * 60 * 60 * 1000 + reauditDelayMs(DOMAIN, PAGE),
    );

  const subject = (over: Partial<ReauditSubject> = {}): ReauditSubject => ({
    domain: DOMAIN,
    pageId: PAGE,
    monitoringEnabled: true,
    latest: null,
    ...over,
  });

  it('is the page own slot on the next day the run will reach it', () => {
    const now = new Date('2026-08-01T23:00:00.000Z');

    expect(nextReauditAt(subject(), now)?.toISOString()).toBe(slot('2026-08-02').toISOString());
  });

  it('is today when the run has not reached this page yet', () => {
    const today = slot('2026-08-01');
    const now = new Date(today.getTime() - 60_000);

    expect(nextReauditAt(subject(), now)?.toISOString()).toBe(today.toISOString());
  });

  it('waits for tomorrow once the page has been audited today', () => {
    const today = slot('2026-08-01');
    const now = new Date(today.getTime() - 60_000);
    const latest = {status: 'done' as const, createdAt: new Date(today.getTime() - 120_000), scheduledFor: null};

    expect(nextReauditAt(subject({latest}), now)?.toISOString()).toBe(slot('2026-08-02').toISOString());
  });

  it('has no next audit while monitoring is paused', () => {
    expect(nextReauditAt(subject({monitoringEnabled: false}), new Date('2026-08-01T09:00:00.000Z'))).toBeNull();
  });

  it('has no next audit while one is actually running', () => {
    const latest = {status: 'running' as const, createdAt: new Date('2026-08-01T02:00:00.000Z'), scheduledFor: null};

    expect(nextReauditAt(subject({latest}), new Date('2026-08-01T05:00:00.000Z'))).toBeNull();
  });

  it('measures a queued audit from when it was actually enqueued', () => {
    const enqueuedAt = new Date('2026-08-01T02:11:00.000Z');
    const latest = {
      status: 'queued' as const,
      createdAt: enqueuedAt,
      scheduledFor: new Date('2026-08-01T00:00:00.000Z'),
    };

    expect(nextReauditAt(subject({latest}), new Date('2026-08-01T02:30:00.000Z'))?.toISOString()).toBe(
      new Date(enqueuedAt.getTime() + reauditDelayMs(DOMAIN, PAGE)).toISOString(),
    );
  });

  it('still reports a queued audit after the page is paused', () => {
    const enqueuedAt = new Date('2026-08-01T02:00:00.000Z');
    const latest = {
      status: 'queued' as const,
      createdAt: enqueuedAt,
      scheduledFor: new Date('2026-08-01T00:00:00.000Z'),
    };

    expect(
      nextReauditAt(subject({monitoringEnabled: false, latest}), new Date('2026-08-01T02:30:00.000Z'))?.toISOString(),
    ).toBe(new Date(enqueuedAt.getTime() + reauditDelayMs(DOMAIN, PAGE)).toISOString());
  });

  it('says nothing about a queued audit the run did not schedule', () => {
    const latest = {status: 'queued' as const, createdAt: new Date('2026-08-01T09:00:00.000Z'), scheduledFor: null};

    expect(nextReauditAt(subject({latest}), new Date('2026-08-01T09:00:01.000Z'))).toBeNull();
  });

  it('keeps two pages on one domain a stagger apart, as the run does', () => {
    const now = new Date('2026-08-01T23:00:00.000Z');
    const first = nextReauditAt(subject(), now);
    const second = nextReauditAt(subject({pageId: 'page-2'}), now);

    expect(first?.toISOString()).not.toBe(second?.toISOString());
  });
});
