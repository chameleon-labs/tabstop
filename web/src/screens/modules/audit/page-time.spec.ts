import {describe, expect, it} from 'vitest';
import type {AuditStatus, LatestPageAudit, PageSummary} from '@tabstop/contract';
import {exactTime, pageTimestamp, relativeTime} from './page-time';

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
