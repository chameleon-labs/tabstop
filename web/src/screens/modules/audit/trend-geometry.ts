import type {AuditStatus, PageHistoryPoint} from '@tabstop/contract';

export type TrendBounds = {lo: number; hi: number};

export const MIN_TREND_RANGE = 20;

const STEP = 5;
const FULL_SCALE: TrendBounds = {lo: 0, hi: 100};

const scoresOf = (points: readonly PageHistoryPoint[]): number[] =>
  points.map(({score}) => score).filter((score) => score !== null);

export const trendBounds = (points: readonly PageHistoryPoint[]): TrendBounds => {
  const values = scoresOf(points);
  if (values.length === 0) {
    return FULL_SCALE;
  }

  let lo = Math.max(0, Math.floor((Math.min(...values) - 4) / STEP) * STEP);
  let hi = Math.min(100, Math.ceil((Math.max(...values) + 4) / STEP) * STEP);

  while (hi - lo < MIN_TREND_RANGE && (lo > 0 || hi < 100)) {
    if (lo > 0) {
      lo -= STEP;
    }
    if (hi - lo < MIN_TREND_RANGE && hi < 100) {
      hi += STEP;
    }
  }

  return {lo, hi};
};

export type TrendPoint = {point: PageHistoryPoint; x: number; y: number | null};

export type TrendBox = {
  width: number;
  height: number;
  padding: {top: number; right: number; bottom: number; left: number};
};

export const trendPositions = (
  points: readonly PageHistoryPoint[],
  box: TrendBox,
  bounds: TrendBounds,
): TrendPoint[] => {
  const {top, left} = box.padding;
  const right = box.width - box.padding.right;
  const bottom = box.height - box.padding.bottom;
  const range = bounds.hi - bounds.lo;

  const times = points.map(({createdAt}) => Date.parse(createdAt));
  const start = times[0] ?? 0;
  const span = (times.at(-1) ?? 0) - start;

  const yFor = (score: number | null): number | null => {
    if (score === null) {
      return null;
    }
    return range <= 0 ? bottom : bottom - ((bottom - top) * (score - bounds.lo)) / range;
  };

  return points.map((point, index) => ({
    point,
    x: span <= 0 ? left : left + ((right - left) * ((times[index] ?? start) - start)) / span,
    y: yFor(point.score),
  }));
};

export const trendSegments = (positioned: readonly TrendPoint[]): TrendPoint[][] => {
  const segments: TrendPoint[][] = [];
  let run: TrendPoint[] = [];

  for (const entry of positioned) {
    if (entry.y === null) {
      if (run.length > 0) {
        segments.push(run);
      }
      run = [];
      continue;
    }

    run.push(entry);
  }

  if (run.length > 0) {
    segments.push(run);
  }

  return segments;
};

export const versionBoundaries = (points: readonly PageHistoryPoint[]): number[] => {
  const boundaries: number[] = [];
  let previous: string | null = null;

  for (const [index, point] of points.entries()) {
    const {axeVersion} = point;
    if (axeVersion === null) {
      continue;
    }

    if (previous !== null && axeVersion !== previous) {
      boundaries.push(index);
    }
    previous = axeVersion;
  }

  return boundaries;
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

export const trendSummary = (points: readonly PageHistoryPoint[]): string => {
  if (points.length === 0) {
    return 'Score trend: no audits in this window.';
  }

  const failures = points.filter(({status}) => status === 'failed').length;
  const tail = failures === 0 ? '' : ` ${plural(failures, 'audit')} failed.`;
  const values = scoresOf(points);
  const [first] = values;
  const last = values.at(-1);

  if (first === undefined || last === undefined) {
    return `Score trend: no completed audits.${tail}`;
  }

  const total = plural(points.length, 'audit');
  if (values.length === 1) {
    return `Score trend: ${first} over ${total}.${tail}`;
  }

  const change = last - first;
  const direction = change === 0 ? 'unchanged' : `${change > 0 ? 'up' : 'down'} ${plural(Math.abs(change), 'point')}`;

  return `Score trend: ${first} to ${last} over ${total}, ${direction}.${tail}`;
};

export const AUDIT_STATUS_LABELS: Readonly<Record<AuditStatus, string>> = {
  queued: 'Queued',
  running: 'Running',
  done: 'Completed',
  failed: 'Failed',
};

export type HistoryRow = {point: PageHistoryPoint; previousScore: number | null};

export const historyRows = (points: readonly PageHistoryPoint[]): HistoryRow[] => {
  const rows: HistoryRow[] = [];
  let previousScore: number | null = null;

  for (const point of points) {
    rows.push({point, previousScore});
    if (point.score !== null) {
      previousScore = point.score;
    }
  }

  return rows.toReversed();
};

export const pointDate = (point: PageHistoryPoint, locale?: string, timeZone?: string): string =>
  new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(timeZone === undefined ? {} : {timeZone}),
  }).format(Date.parse(point.createdAt));

export const pointDescription = (point: PageHistoryPoint, locale?: string, timeZone?: string): string => {
  const date = pointDate(point, locale, timeZone);

  if (point.score === null) {
    return `${date}: audit ${point.status}`;
  }

  const engine = point.axeVersion === null ? '' : `, axe-core ${point.axeVersion}`;

  return `${date}: score ${point.score} out of 100${engine}`;
};
