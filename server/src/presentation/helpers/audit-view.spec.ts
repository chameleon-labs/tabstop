import {describe, expect, it} from 'vitest';
import {toAuditResultResponse} from './audit-view.js';
import type {AuditModel} from '../../domain/models/audit.js';
import type {ViolationModel} from '../../domain/models/violation.js';

const audit = (overrides: Partial<AuditModel> = {}): AuditModel => ({
  id: 'audit-internal-1',
  publicUuid: '11111111-1111-1111-1111-111111111111',
  pageId: null,
  url: 'https://example.test/a',
  status: 'done',
  score: 87,
  countsByImpact: {minor: 1, moderate: 2, serious: 3, critical: 4},
  axeVersion: '4.12.1',
  durationMs: 1234,
  error: null,
  createdAt: new Date('2026-07-28T10:00:00Z'),
  completedAt: new Date('2026-07-28T10:00:30Z'),
  settled: true,
  ...overrides,
});

const violation = (overrides: Partial<ViolationModel> = {}): ViolationModel => ({
  id: 'violation-internal-1',
  auditId: 'audit-internal-1',
  ruleId: 'image-alt',
  impact: 'critical',
  description: 'Images must have alternate text',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
  nodes: [{target: ['img'], html: '<img>'}],
  ...overrides,
});

describe('toAuditResultResponse', () => {
  it('exposes the public uuid and never the internal id', () => {
    const response = toAuditResultResponse({audit: audit(), violations: []});

    expect(response.auditId).toBe('11111111-1111-1111-1111-111111111111');
    expect(JSON.stringify(response)).not.toContain('audit-internal-1');
  });

  it('omits every field that could identify a user', () => {
    // This response is public, gated only by an unguessable uuid. pageId links
    // to a site and therefore to an account, so it is the leak - and a spread
    // or a later select * is exactly how it comes back.
    const response = toAuditResultResponse({
      audit: audit({pageId: 'page-99'}),
      violations: [],
    });

    for (const forbidden of ['pageId', 'page_id', 'id', 'siteId', 'userId', 'durationMs']) {
      expect(Object.keys(response)).not.toContain(forbidden);
    }
    expect(JSON.stringify(response)).not.toContain('page-99');
  });

  it('drops the violation row ids too', () => {
    const response = toAuditResultResponse({audit: audit(), violations: [violation()]});

    expect(JSON.stringify(response)).not.toContain('violation-internal-1');
    expect(Object.keys(response.violations[0] ?? {}).sort()).toEqual([
      'description',
      'helpUrl',
      'impact',
      'nodes',
      'ruleId',
    ]);
  });

  it('carries dates as ISO strings, not Date objects', () => {
    const response = toAuditResultResponse({audit: audit(), violations: []});

    expect(response.createdAt).toBe('2026-07-28T10:00:00.000Z');
    expect(response.completedAt).toBe('2026-07-28T10:00:30.000Z');
  });

  it('maps the score through for a completed audit', () => {
    const response = toAuditResultResponse({audit: audit({score: 87}), violations: []});

    expect(response.score).toBe(87);
  });

  it('reports a null completion for an audit that has not finished', () => {
    const response = toAuditResultResponse({
      audit: audit({status: 'queued', completedAt: null, score: null, axeVersion: null}),
      violations: [],
    });

    expect(response.completedAt).toBeNull();
    expect(response.score).toBeNull();
    expect(response.status).toBe('queued');
  });

  it('keeps a violation whose severity axe did not report', () => {
    // Dropping it would hide a real finding, which is why the column is
    // nullable in the first place.
    const response = toAuditResultResponse({
      audit: audit(),
      violations: [violation({impact: null})],
    });

    expect(response.violations[0]?.impact).toBeNull();
  });

  it('passes settled through, so a provisional score is recognisable', () => {
    const response = toAuditResultResponse({
      audit: audit({settled: false}),
      violations: [],
    });

    expect(response.settled).toBe(false);
  });
});
