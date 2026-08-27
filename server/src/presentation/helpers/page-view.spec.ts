import {describe, expect, it} from 'vitest';
import type {LoadPagesResponse, PageHistoryResponse, PageSummary as PageSummaryResponse} from '@tabstop/contract';
import type {AuditModel} from '../../domain/models/audit.js';
import type {PageModel, ScheduledPageSummary} from '../../domain/models/page.js';
import type {PageHistory} from '../../domain/usecases/load-page-history.js';
import {toPageHistoryView, toPageSummaryView, toPageView} from './page-view.js';

const page: PageModel = {
  id: 'page-1',
  siteId: 'site-secret-1',
  url: 'https://example.test/pricing',
  monitoringEnabled: true,
  createdAt: new Date('2026-08-15T10:00:00Z'),
};

const audit: AuditModel = {
  id: 'audit-internal-1',
  publicUuid: '11111111-1111-1111-1111-111111111111',
  pageId: 'page-1',
  url: page.url,
  status: 'done',
  score: 74,
  countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
  axeVersion: '4.12.1',
  durationMs: 1_200,
  error: null,
  createdAt: new Date('2026-08-15T10:01:00Z'),
  completedAt: new Date('2026-08-15T10:01:30Z'),
  scheduledFor: null,
  settled: true,
};

const summary = (overrides: Partial<ScheduledPageSummary> = {}): ScheduledPageSummary => ({
  page,
  domain: 'example.test',
  latestAudit: audit,
  nextAuditAt: new Date('2026-08-16T05:12:00.000Z'),
  history: [
    {score: 86, at: new Date('2026-08-14T10:00:00Z')},
    {score: 74, at: new Date('2026-08-15T10:00:00Z')},
  ],
  ...overrides,
});

describe('the page view mappers', () => {
  it('maps exactly the dashboard contract without internal ids', () => {
    const view: PageSummaryResponse = toPageSummaryView(summary());
    const body: LoadPagesResponse = {pages: [view], limit: 10, used: 1};

    expect(body.used).toBe(1);
    expect(view).toMatchObject({
      id: 'page-1',
      domain: 'example.test',
      score: 74,
      previousScore: 86,
      latestAudit: {auditId: audit.publicUuid, status: 'done', score: 74},
      history: [
        {score: 86, at: '2026-08-14T10:00:00.000Z'},
        {score: 74, at: '2026-08-15T10:00:00.000Z'},
      ],
    });
  });

  it('serialises the next audit, and says null when there is not one', () => {
    expect(toPageSummaryView(summary()).nextAuditAt).toBe('2026-08-16T05:12:00.000Z');
    expect(toPageSummaryView(summary({nextAuditAt: null})).nextAuditAt).toBeNull();
  });

  it('never puts an internal identifier on the wire', () => {
    const serialised = JSON.stringify(toPageSummaryView(summary()));

    expect(serialised).not.toContain('site-secret-1');
    expect(serialised).not.toContain('audit-internal-1');
  });

  it('publishes exactly four page fields, so a later model column cannot leak', () => {
    expect(Object.keys(toPageView(page)).toSorted()).toEqual(['createdAt', 'id', 'monitoringEnabled', 'url']);
  });

  it('serialises every date as an ISO string', () => {
    const view = toPageSummaryView(summary());

    expect(view.createdAt).toBe('2026-08-15T10:00:00.000Z');
    expect(view.latestAudit?.createdAt).toBe('2026-08-15T10:01:00.000Z');
    expect(view.latestAudit?.completedAt).toBe('2026-08-15T10:01:30.000Z');
  });

  it('reports no score rather than zero when nothing has finished', () => {
    const view = toPageSummaryView(
      summary({
        latestAudit: {...audit, status: 'failed', score: null, completedAt: null, error: 'Navigation timeout'},
        history: [],
      }),
    );

    expect(view.score).toBeNull();
    expect(view.previousScore).toBeNull();
    expect(view.history).toEqual([]);
    expect(view.latestAudit).toMatchObject({status: 'failed', score: null, completedAt: null});
  });

  it('keeps the last successful score when the latest run failed', () => {
    const view = toPageSummaryView(
      summary({latestAudit: {...audit, status: 'failed', score: null, error: 'Navigation timeout'}}),
    );

    expect(view.score).toBe(74);
    expect(view.previousScore).toBe(86);
  });

  it('reports a single completed score with no previous score', () => {
    const view = toPageSummaryView(summary({history: [{score: 74, at: new Date('2026-08-15T10:00:00Z')}]}));

    expect(view.score).toBe(74);
    expect(view.previousScore).toBeNull();
  });

  it('carries a null latest audit through', () => {
    const view = toPageSummaryView(summary({latestAudit: null}));

    expect(view.latestAudit).toBeNull();
  });
});

const failedAudit: AuditModel = {
  ...audit,
  id: 'audit-internal-2',
  publicUuid: '22222222-2222-2222-2222-222222222222',
  status: 'failed',
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: null,
  error: 'Navigation timeout',
  createdAt: new Date('2026-08-16T10:01:00Z'),
  completedAt: null,
  scheduledFor: null,
  settled: true,
};

const history = (audits: AuditModel[] = [audit, failedAudit]): PageHistory => ({page, audits});

describe('the page history mapper', () => {
  it('maps the wire shape the trend chart reads, with dates as ISO strings', () => {
    const view: PageHistoryResponse = toPageHistoryView(history(), 90);

    expect(view).toEqual({
      pageId: 'page-1',
      url: 'https://example.test/pricing',
      days: 90,
      points: [
        {
          auditId: '11111111-1111-1111-1111-111111111111',
          createdAt: '2026-08-15T10:01:00.000Z',
          status: 'done',
          score: 74,
          countsByImpact: {minor: 1, moderate: 2, serious: 0, critical: 1},
          axeVersion: '4.12.1',
        },
        {
          auditId: '22222222-2222-2222-2222-222222222222',
          createdAt: '2026-08-16T10:01:00.000Z',
          status: 'failed',
          score: null,
          countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
          axeVersion: null,
        },
      ],
    });
  });

  it('echoes the window the server actually used, not the one that was asked for', () => {
    expect(toPageHistoryView(history(), 365).days).toBe(365);
  });

  it('leaves the points oldest first, so a chart renders in array order', () => {
    const view = toPageHistoryView(history([failedAudit, audit]), 90);

    expect(view.points.map((point) => point.createdAt)).toEqual([
      '2026-08-16T10:01:00.000Z',
      '2026-08-15T10:01:00.000Z',
    ]);
  });

  it('keeps a failed run as a point with no score rather than dropping it', () => {
    const view = toPageHistoryView(history([failedAudit]), 90);

    expect(view.points).toHaveLength(1);
    expect(view.points[0]).toMatchObject({status: 'failed', score: null});
  });

  it('never puts an internal identifier on the wire', () => {
    const serialised = JSON.stringify(toPageHistoryView(history(), 90));

    expect(serialised).not.toContain('site-secret-1');
    expect(serialised).not.toContain('audit-internal-1');
    expect(serialised).not.toContain('audit-internal-2');
  });
});
