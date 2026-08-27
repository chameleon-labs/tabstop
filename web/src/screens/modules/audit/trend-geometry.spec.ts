import {describe, expect, it} from 'vitest';
import type {PageHistoryPoint} from '@tabstop/contract';
import {
  MIN_TREND_RANGE,
  historyRows,
  pointDate,
  pointDescription,
  trendBounds,
  trendPositions,
  trendSegments,
  trendSummary,
  versionBoundaries,
  type TrendBox,
} from './trend-geometry';

const point = (overrides: Partial<PageHistoryPoint> = {}): PageHistoryPoint => ({
  auditId: 'audit-1',
  createdAt: '2026-08-15T10:00:00.000Z',
  status: 'done',
  score: 74,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: '4.12.1',
  ...overrides,
});

const scored = (at: string, score: number, axeVersion: string | null = '4.12.1'): PageHistoryPoint =>
  point({auditId: `audit-${at}`, createdAt: at, score, axeVersion});

const failed = (at: string): PageHistoryPoint =>
  point({auditId: `audit-${at}`, createdAt: at, status: 'failed', score: null, axeVersion: null});

const scores = (values: readonly number[]): PageHistoryPoint[] =>
  values.map((score, index) => scored(`2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`, score));

const BOX: TrendBox = {width: 600, height: 200, padding: {top: 10, right: 10, bottom: 30, left: 40}};
const LEFT = BOX.padding.left;
const RIGHT = BOX.width - BOX.padding.right;
const TOP = BOX.padding.top;
const BOTTOM = BOX.height - BOX.padding.bottom;

describe('trendBounds', () => {
  it('fits the axis to the scores rather than the full range', () => {
    expect(trendBounds(scores([74, 81, 92, 88]))).toEqual({lo: 70, hi: 100});
  });

  it('refuses to magnify a flat series into a crisis', () => {
    const bounds = trendBounds(scores([90, 90, 90]));

    expect(bounds.hi - bounds.lo).toBeGreaterThanOrEqual(MIN_TREND_RANGE);
    expect(90 - bounds.lo).toBe(bounds.hi - 90);
  });

  it('widens a near-flat series without leaving the scale', () => {
    const bounds = trendBounds(scores([89, 90, 91]));

    expect(bounds.hi - bounds.lo).toBeGreaterThanOrEqual(MIN_TREND_RANGE);
    expect(bounds.lo).toBeGreaterThanOrEqual(0);
    expect(bounds.hi).toBeLessThanOrEqual(100);
  });

  it('never drops below zero, however low the scores go', () => {
    const bounds = trendBounds(scores([0, 6]));

    expect(bounds.lo).toBe(0);
    expect(bounds.hi - bounds.lo).toBeGreaterThanOrEqual(MIN_TREND_RANGE);
  });

  it('never climbs above a hundred, however high the scores go', () => {
    const bounds = trendBounds(scores([97, 100]));

    expect(bounds.hi).toBe(100);
    expect(bounds.lo).toBeGreaterThanOrEqual(0);
    expect(bounds.hi - bounds.lo).toBeGreaterThanOrEqual(MIN_TREND_RANGE);
  });

  it('falls back to the whole scale when there is nothing to fit', () => {
    expect(trendBounds([failed('2026-07-01T00:00:00.000Z'), failed('2026-07-02T00:00:00.000Z')])).toEqual({
      lo: 0,
      hi: 100,
    });
    expect(trendBounds([])).toEqual({lo: 0, hi: 100});
  });
});

describe('trendPositions', () => {
  const bounds = {lo: 70, hi: 100};

  it('spaces the points by when they ran, not by how many there are', () => {
    const positions = trendPositions(
      [
        scored('2026-07-01T00:00:00.000Z', 90),
        scored('2026-07-02T00:00:00.000Z', 88),
        scored('2026-08-01T00:00:00.000Z', 74),
      ],
      BOX,
      bounds,
    );

    expect(positions[0]!.x).toBe(LEFT);
    expect(positions[2]!.x).toBe(RIGHT);
    expect(positions[1]!.x).toBeCloseTo(LEFT + (RIGHT - LEFT) / 31, 1);
    expect(positions[1]!.x - positions[0]!.x).toBeLessThan((positions[2]!.x - positions[1]!.x) / 10);
  });

  it('puts a lone point at the left edge without dividing by zero', () => {
    const positions = trendPositions([scored('2026-07-01T00:00:00.000Z', 90)], BOX, bounds);

    expect(positions[0]!.x).toBe(LEFT);
    expect(Number.isNaN(positions[0]!.y)).toBe(false);
  });

  it('maps the top and the bottom of the fitted axis onto the plot area', () => {
    const positions = trendPositions(
      [
        scored('2026-07-01T00:00:00.000Z', 100),
        scored('2026-07-02T00:00:00.000Z', 85),
        scored('2026-07-03T00:00:00.000Z', 70),
      ],
      BOX,
      bounds,
    );

    expect(positions[0]!.y).toBe(TOP);
    expect(positions[1]!.y).toBe((TOP + BOTTOM) / 2);
    expect(positions[2]!.y).toBe(BOTTOM);
  });

  it('gives a failed run an x but no y, because its marker sits on the baseline', () => {
    const positions = trendPositions(
      [scored('2026-07-01T00:00:00.000Z', 90), failed('2026-07-02T00:00:00.000Z')],
      BOX,
      bounds,
    );

    expect(positions[1]!.y).toBeNull();
    expect(positions[1]!.x).toBe(RIGHT);
    expect(positions[1]!.point.status).toBe('failed');
  });
});

describe('trendSegments', () => {
  const bounds = {lo: 70, hi: 100};
  const positioned = (points: readonly PageHistoryPoint[]): ReturnType<typeof trendPositions> =>
    trendPositions(points, BOX, bounds);

  const day = (index: number): string => `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`;

  it('breaks the line at a failure rather than bridging it', () => {
    const segments = trendSegments(
      positioned([scored(day(0), 90), scored(day(1), 88), failed(day(2)), scored(day(3), 74), scored(day(4), 76)]),
    );

    expect(segments).toHaveLength(2);
    expect(segments.map((segment) => segment.length)).toEqual([2, 2]);
  });

  it('leaves no empty segment at either end', () => {
    const segments = trendSegments(
      positioned([failed(day(0)), scored(day(1), 90), scored(day(2), 88), failed(day(3))]),
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(2);
  });

  it('draws nothing at all when every run failed', () => {
    expect(trendSegments(positioned([failed(day(0)), failed(day(1))]))).toEqual([]);
  });
});

describe('versionBoundaries', () => {
  const day = (index: number): string => `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`;

  it('marks the first point of each new engine version', () => {
    expect(
      versionBoundaries([
        scored(day(0), 90, '4.11.0'),
        scored(day(1), 88, '4.11.0'),
        scored(day(2), 74, '4.12.1'),
        scored(day(3), 76, '4.12.1'),
      ]),
    ).toEqual([2]);
  });

  it('never marks the first point, which changed nothing', () => {
    expect(versionBoundaries([scored(day(0), 90, '4.11.0'), scored(day(1), 88, '4.11.0')])).toEqual([]);
    expect(versionBoundaries([scored(day(0), 90, '4.11.0')])).toEqual([]);
  });

  it('does not read a run that never recorded a version as a change', () => {
    expect(versionBoundaries([scored(day(0), 90, '4.11.0'), failed(day(1)), scored(day(2), 88, '4.11.0')])).toEqual([]);
    expect(versionBoundaries([scored(day(0), 90, '4.11.0'), failed(day(1)), scored(day(2), 88, '4.12.1')])).toEqual([
      2,
    ]);
  });
});

describe('trendSummary', () => {
  const day = (index: number): string => `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`;

  it('names the ends, the count, the direction and the failures', () => {
    expect(trendSummary([scored(day(0), 91), failed(day(1)), scored(day(2), 74)])).toBe(
      'Score trend: 91 to 74 over 3 audits, down 17 points. 1 audit failed.',
    );
  });

  it('says nothing about failures when there were none', () => {
    expect(trendSummary([scored(day(0), 74), scored(day(1), 91)])).toBe(
      'Score trend: 74 to 91 over 2 audits, up 17 points.',
    );
  });

  it('counts more than one failure', () => {
    expect(trendSummary([scored(day(0), 91), failed(day(1)), failed(day(2)), scored(day(3), 91)])).toBe(
      'Score trend: 91 to 91 over 4 audits, unchanged. 2 audits failed.',
    );
  });

  it('reads a single point without inventing a comparison', () => {
    expect(trendSummary([scored(day(0), 74)])).toBe('Score trend: 74 over 1 audit.');
  });

  it('says the window is empty rather than describing a chart that is not there', () => {
    expect(trendSummary([])).toBe('Score trend: no audits in this window.');
  });

  it('says so when nothing in the window finished', () => {
    expect(trendSummary([failed(day(0)), failed(day(1))])).toBe('Score trend: no completed audits. 2 audits failed.');
  });
});

describe('historyRows', () => {
  const day = (index: number): string => `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`;

  it('reads newest first, because a list is read from the top', () => {
    const rows = historyRows([scored(day(0), 90), scored(day(1), 82)]);

    expect(rows.map((row) => row.point.score)).toEqual([82, 90]);
  });

  it('compares against the last run that finished, not the last run', () => {
    const rows = historyRows([scored(day(0), 90), failed(day(1)), scored(day(2), 82)]);

    expect(rows[0]?.previousScore).toBe(90);
    expect(rows[1]?.previousScore).toBe(90);
  });

  it('leaves the first score in the window with nothing to compare against', () => {
    expect(historyRows([scored(day(0), 90)])[0]?.previousScore).toBeNull();
  });
});

describe('pointDate', () => {
  it('names the day a run happened, in the reader locale', () => {
    expect(pointDate(scored('2026-08-15T10:00:00.000Z', 74), 'en-GB', 'UTC')).toBe('15 August 2026');
    expect(pointDate(scored('2026-08-15T10:00:00.000Z', 74), 'en-US', 'UTC')).toBe('August 15, 2026');
  });
});

describe('pointDescription', () => {
  it('reads a scored run as a date, a score and the engine that produced it', () => {
    expect(pointDescription(scored('2026-08-15T10:00:00.000Z', 74, '4.12.1'), 'en-GB', 'UTC')).toBe(
      '15 August 2026: score 74 out of 100, axe-core 4.12.1',
    );
  });

  it('reads a failed run as a failure, never as a zero', () => {
    expect(pointDescription(failed('2026-08-02T10:00:00.000Z'), 'en-GB', 'UTC')).toBe('2 August 2026: audit failed');
  });

  it('leaves the engine out when the run never recorded one', () => {
    expect(pointDescription(scored('2026-08-15T10:00:00.000Z', 74, null), 'en-GB', 'UTC')).toBe(
      '15 August 2026: score 74 out of 100',
    );
  });

  it('describes a run that has not finished as what it is', () => {
    expect(
      pointDescription(
        point({createdAt: '2026-08-15T10:00:00.000Z', status: 'running', score: null, axeVersion: null}),
        'en-GB',
        'UTC',
      ),
    ).toBe('15 August 2026: audit running');
  });
});
