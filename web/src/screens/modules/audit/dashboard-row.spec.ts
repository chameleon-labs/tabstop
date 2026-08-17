import {describe, expect, it} from 'vitest';
import type {AuditStatus, LatestPageAudit, PageScorePoint, PageSummary} from '@tabstop/contract';
import {dashboardRowState} from './dashboard-row';

type Patch = {
  monitoringEnabled?: boolean;
  latestStatus?: AuditStatus | null;
  latestScore?: number | null;
  history?: PageScorePoint[];
};

const HISTORY: PageScorePoint[] = [
  {score: 86, at: '2026-08-14T10:00:00.000Z'},
  {score: 74, at: '2026-08-15T10:00:00.000Z'},
];

const latestAudit = (status: AuditStatus, score: number | null): LatestPageAudit => ({
  auditId: '11111111-1111-1111-1111-111111111111',
  status,
  score,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  createdAt: '2026-08-15T10:00:00.000Z',
  completedAt: status === 'done' || status === 'failed' ? '2026-08-15T10:01:00.000Z' : null,
  error: status === 'failed' ? 'Navigation timeout' : null,
});

const pageSummary = (patch: Patch = {}): PageSummary => {
  const {monitoringEnabled = true, latestStatus = 'done', latestScore = 74, history = HISTORY} = patch;

  return {
    id: 'page-1',
    url: 'https://example.test/checkout',
    monitoringEnabled,
    createdAt: '2026-08-01T10:00:00.000Z',
    domain: 'example.test',
    latestAudit: latestStatus === null ? null : latestAudit(latestStatus, latestScore),
    score: history.at(-1)?.score ?? null,
    previousScore: history.at(-2)?.score ?? null,
    history,
    nextAuditAt: null,
  };
};

describe('dashboardRowState', () => {
  it.each([
    {name: 'paused monitoring', patch: {monitoringEnabled: false}, expected: 'paused'},
    {name: 'a failed latest audit', patch: {latestStatus: 'failed' as const}, expected: 'failed'},
    {name: 'a queued first audit', patch: {latestStatus: 'queued' as const, history: []}, expected: 'first-audit'},
    {name: 'a running first audit', patch: {latestStatus: 'running' as const, history: []}, expected: 'first-audit'},
    {name: 'a running later audit', patch: {latestStatus: 'running' as const}, expected: 'reaudit'},
    {name: 'a completed score', patch: {latestStatus: 'done' as const}, expected: 'scored'},
    {name: 'no audit row at all', patch: {latestStatus: null, history: []}, expected: 'unstarted'},
  ])('classifies $name as $expected', ({patch, expected}) => {
    expect(dashboardRowState(pageSummary(patch)).kind).toBe(expected);
  });

  it('ranks paused above a failed audit, because the user turned it off deliberately', () => {
    expect(dashboardRowState(pageSummary({monitoringEnabled: false, latestStatus: 'failed'})).kind).toBe('paused');
  });

  it('ranks paused above work still in flight', () => {
    expect(dashboardRowState(pageSummary({monitoringEnabled: false, latestStatus: 'running'})).kind).toBe('paused');
  });

  it.each([
    {name: 'paused', patch: {monitoringEnabled: false}},
    {name: 'failed', patch: {latestStatus: 'failed' as const}},
  ])('keeps $name history but calls the number what it is', ({patch}) => {
    // The retained score is not the current one. Labelling it "Score" would
    // claim the page scores 74 right now, which is exactly what is unknown.
    const state = dashboardRowState(pageSummary(patch));

    expect(state.scoreLabel).toBe('Last successful score');
    expect(state.showScore).toBe(true);
    expect(state.showDelta).toBe(true);
    expect(state.showTrend).toBe(true);
  });

  it('shows nothing numeric for a paused page that never completed an audit', () => {
    const state = dashboardRowState(pageSummary({monitoringEnabled: false, history: []}));

    expect(state.scoreLabel).toBeNull();
    expect(state.showScore).toBe(false);
    expect(state.showDelta).toBe(false);
    expect(state.showTrend).toBe(false);
  });

  it.each([
    {name: 'queued', status: 'queued' as const},
    {name: 'running', status: 'running' as const},
  ])('hides every metric while the $name first audit runs', ({status}) => {
    // There is nothing to compare against yet, and a zero would be a lie.
    const state = dashboardRowState(pageSummary({latestStatus: status, history: []}));

    expect(state.kind).toBe('first-audit');
    expect(state.showScore).toBe(false);
    expect(state.showDelta).toBe(false);
    expect(state.showTrend).toBe(false);
    expect(state.inFlightPrefix).toBe('First audit');
  });

  it('keeps the previous result visible while a re-audit runs', () => {
    const state = dashboardRowState(pageSummary({latestStatus: 'running'}));

    expect(state).toEqual({
      kind: 'reaudit',
      scoreLabel: 'Score',
      showScore: true,
      showDelta: true,
      showTrend: true,
      inFlightPrefix: 'Re-audit',
    });
  });

  it('shows a single score with its one-point trend, and no invented delta', () => {
    // `previousScore` is null here, which is what makes ScoreDelta say "First
    // score" rather than a zero change that never happened.
    const page = pageSummary({history: [{score: 74, at: '2026-08-15T10:00:00.000Z'}]});
    const state = dashboardRowState(page);

    expect(state.kind).toBe('scored');
    expect(state.scoreLabel).toBe('Score');
    expect(state.showScore).toBe(true);
    expect(state.showDelta).toBe(true);
    expect(state.showTrend).toBe(true);
    expect(page.previousScore).toBeNull();
  });

  it('draws no trend for a scored row with no history to draw', () => {
    const state = dashboardRowState({...pageSummary({history: []}), score: 74});

    expect(state.kind).toBe('scored');
    expect(state.showScore).toBe(true);
    expect(state.showTrend).toBe(false);
  });

  it('never treats a missing audit row as work in progress', () => {
    // The server deletes the queued row when the first job definitively fails
    // to enqueue. Reading null as "running" leaves a spinner up forever.
    const state = dashboardRowState(pageSummary({latestStatus: null, history: []}));

    expect(state.kind).toBe('unstarted');
    expect(state.inFlightPrefix).toBeNull();
  });

  it('refuses to show a score for a completed audit that has none', () => {
    const state = dashboardRowState(pageSummary({latestStatus: 'done', latestScore: null, history: []}));

    expect(state.showScore).toBe(false);
    expect(state.showDelta).toBe(false);
    expect(state.scoreLabel).toBeNull();
  });

  it('never announces an in-flight prefix for a settled row', () => {
    for (const patch of [{}, {latestStatus: 'failed' as const}, {monitoringEnabled: false}]) {
      expect(dashboardRowState(pageSummary(patch)).inFlightPrefix).toBeNull();
    }
  });
});
