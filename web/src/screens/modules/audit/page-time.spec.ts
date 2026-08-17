import {describe, expect, it} from 'vitest';
import type {AuditStatus, LatestPageAudit, PageSummary} from '@tabstop/contract';
import {UNKNOWN_RELATIVE, exactTime, nextAuditTime, pageTimestamp, relativeTime} from './page-time';

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

const latestAudit = (status: AuditStatus, completedAt: string | null): LatestPageAudit => ({
  auditId: '11111111-1111-1111-1111-111111111111',
  status,
  score: status === 'done' ? 74 : null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  createdAt: '2026-08-15T10:00:00.000Z',
  completedAt,
  error: status === 'failed' ? 'Navigation timeout' : null,
});

const pageSummary = (latest: LatestPageAudit | null): PageSummary => ({
  id: 'page-1',
  url: 'https://example.test/checkout',
  monitoringEnabled: true,
  createdAt: '2026-08-01T09:00:00.000Z',
  domain: 'example.test',
  latestAudit: latest,
  score: null,
  previousScore: null,
  history: [],
  nextAuditAt: null,
});

describe('relativeTime', () => {
  it.each([
    {name: 'seconds', value: '2026-08-15T11:59:40.000Z', expected: 'just now'},
    {name: 'minutes', value: '2026-08-15T11:42:00.000Z', expected: '18 minutes ago'},
    {name: 'one minute', value: '2026-08-15T11:59:00.000Z', expected: '1 minute ago'},
    {name: 'hours', value: '2026-08-15T10:00:00.000Z', expected: '2 hours ago'},
    {name: 'days', value: '2026-08-11T12:00:00.000Z', expected: '4 days ago'},
    {name: 'months', value: '2026-06-15T12:00:00.000Z', expected: '2 months ago'},
    {name: 'years', value: '2024-08-15T12:00:00.000Z', expected: '2 years ago'},
  ])('reads $name plainly', ({value, expected}) => {
    expect(relativeTime(value, NOW, 'en')).toBe(expected);
  });

  it.each([
    {name: 'seconds', value: '2026-08-15T12:00:03.000Z'},
    {name: 'minutes', value: '2026-08-15T12:10:00.000Z'},
    {name: 'hours', value: '2026-08-15T15:00:00.000Z'},
  ])('never says a page was audited $name into the future', ({value}) => {
    // Clock skew between the server and the browser is ordinary, and "in 3
    // hours" reads as a bug in the product rather than in the clock.
    expect(relativeTime(value, NOW, 'en')).toBe('just now');
  });

  it('says so rather than letting an invalid date escape', () => {
    expect(relativeTime('not a timestamp', NOW, 'en')).toBe('Unknown time');
  });
});

describe('exactTime', () => {
  it('names the day and the time, which is what the relative label hides', () => {
    expect(exactTime('2026-08-15T10:00:00.000Z', 'en-US', 'UTC')).toContain('Aug 15, 2026');
  });

  it('says so rather than letting an invalid date escape', () => {
    expect(exactTime('not a timestamp', 'en-US', 'UTC')).toBe('Unknown audit time');
  });
});

describe('pageTimestamp', () => {
  it('reports when a finished audit finished', () => {
    expect(pageTimestamp(pageSummary(latestAudit('done', '2026-08-15T10:01:00.000Z')))).toEqual({
      value: '2026-08-15T10:01:00.000Z',
      prefix: 'Audited',
    });
  });

  it('calls a failed run an attempt, not an audit', () => {
    expect(pageTimestamp(pageSummary(latestAudit('failed', '2026-08-15T10:01:00.000Z')))).toEqual({
      value: '2026-08-15T10:01:00.000Z',
      prefix: 'Attempted',
    });
  });

  it('falls back to the start when a finished run recorded no end', () => {
    expect(pageTimestamp(pageSummary(latestAudit('failed', null)))).toEqual({
      value: '2026-08-15T10:00:00.000Z',
      prefix: 'Attempted',
    });
  });

  it.each([
    {name: 'queued', status: 'queued' as const},
    {name: 'running', status: 'running' as const},
  ])('reports when $name work started, since it has not ended', ({status}) => {
    expect(pageTimestamp(pageSummary(latestAudit(status, null)))).toEqual({
      value: '2026-08-15T10:00:00.000Z',
      prefix: 'Audit started',
    });
  });

  it('falls back to when the page was added when no audit exists', () => {
    expect(pageTimestamp(pageSummary(null))).toEqual({
      value: '2026-08-01T09:00:00.000Z',
      prefix: 'Added',
    });
  });
});

describe('nextAuditTime', () => {
  const AT = Date.parse('2026-08-15T12:00:00.000Z');

  it('names the clock time when the run reaches the page today', () => {
    expect(nextAuditTime('2026-08-15T17:30:00.000Z', AT, 'en-GB', 'UTC')).toBe('at 17:30 UTC');
  });

  it('says tomorrow rather than leaving the day to be guessed', () => {
    // "at 05:30" alone is read as today, and the slot is usually not today.
    expect(nextAuditTime('2026-08-16T05:30:00.000Z', AT, 'en-GB', 'UTC')).toBe('tomorrow at 05:30 UTC');
  });

  it('names the date once it is further out than that', () => {
    expect(nextAuditTime('2026-08-18T05:30:00.000Z', AT, 'en-GB', 'UTC')).toBe('on 18 Aug 2026');
  });

  it('reads today in the reader own zone, not in the machine one', () => {
    // 23:00 UTC is already tomorrow in Tokyo, so "now" and the slot fall on one
    // calendar day there while landing on two anywhere west of it. Comparing
    // the slot against a day computed in some other zone reports "tomorrow" for
    // something happening this evening.
    const late = Date.parse('2026-08-15T23:00:00.000Z');

    expect(nextAuditTime('2026-08-16T00:30:00.000Z', late, 'en-GB', 'Asia/Tokyo')).toBe('at 09:30 GMT+9');
  });

  it('says nothing it cannot know from an unparseable timestamp', () => {
    expect(nextAuditTime('not a date', AT, 'en-GB', 'UTC')).toBe(UNKNOWN_RELATIVE);
  });
});

describe('nextAuditTime across a daylight-saving change', () => {
  // London gains an hour on 25 October 2026: that local day is 25 hours long,
  // so "now + 24h" is still the same day and an audit due tomorrow would be
  // reported without its clock time.
  it('still says tomorrow when the local day is twenty-five hours', () => {
    // 25 October is 25 hours long in London, so adding a day to a moment just
    // after its midnight lands back on the same date and tomorrow is missed.
    const justAfterMidnight = Date.parse('2026-10-24T23:30:00.000Z');

    expect(nextAuditTime('2026-10-26T00:30:00.000Z', justAfterMidnight, 'en-GB', 'Europe/London')).toBe(
      'tomorrow at 00:30 GMT',
    );
  });

  it('still says tomorrow when the local day is twenty-three hours', () => {
    // 29 March is 23 hours long, so the same addition overshoots it entirely
    // and lands on the day after tomorrow.
    const justBeforeMidnight = Date.parse('2026-03-28T23:30:00.000Z');

    expect(nextAuditTime('2026-03-29T22:00:00.000Z', justBeforeMidnight, 'en-GB', 'Europe/London')).toBe(
      'tomorrow at 23:00 BST',
    );
  });
});

describe('pageTimestamp for an audit that is scheduled but not started', () => {
  const queued = (nextAuditAt: string | null, history: {score: number; at: string}[] = []): PageSummary => ({
    ...pageSummary(latestAudit('queued', null)),
    history,
    nextAuditAt,
  });

  it('reports the last finished audit rather than claiming this one started', () => {
    // "Audit started 2 hours ago" beside "Next audit at 05:30" says the audit
    // both has and has not begun.
    const timestamp = pageTimestamp(queued('2026-08-16T05:30:00.000Z', [{score: 74, at: '2026-08-15T05:30:00.000Z'}]));

    expect(timestamp).toEqual({value: '2026-08-15T05:30:00.000Z', prefix: 'Audited'});
  });

  it('falls back to when the page was added if nothing has finished', () => {
    expect(pageTimestamp(queued('2026-08-16T05:30:00.000Z')).prefix).toBe('Added');
  });

  it('still says an audit started once it really has', () => {
    // No future slot means the queued job is the one about to run, not one
    // waiting behind a jitter delay.
    expect(pageTimestamp(queued(null)).prefix).toBe('Audit started');
  });
});
