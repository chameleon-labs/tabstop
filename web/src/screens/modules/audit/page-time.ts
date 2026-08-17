import type {PageSummary} from '@tabstop/contract';

export const UNKNOWN_RELATIVE = 'Unknown time';
export const UNKNOWN_EXACT = 'Unknown audit time';

export type PageTimestamp = {
  value: string;
  prefix: 'Audited' | 'Audit started' | 'Attempted' | 'Added';
};

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

const UNITS: readonly {limit: number; size: number; unit: Intl.RelativeTimeFormatUnit}[] = [
  {limit: HOUR, size: MINUTE, unit: 'minute'},
  {limit: DAY, size: HOUR, unit: 'hour'},
  {limit: MONTH, size: DAY, unit: 'day'},
  {limit: YEAR, size: MONTH, unit: 'month'},
  {limit: Number.POSITIVE_INFINITY, size: YEAR, unit: 'year'},
];

export const relativeTime = (timestamp: string, now: number = Date.now(), locale?: string): string => {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return UNKNOWN_RELATIVE;
  }

  const elapsed = now - parsed;
  if (elapsed < MINUTE) {
    return 'just now';
  }

  const format = new Intl.RelativeTimeFormat(locale, {numeric: 'always'});
  const {size, unit} = UNITS.find(({limit}) => elapsed < limit) ?? UNITS[UNITS.length - 1]!;

  return format.format(-Math.floor(elapsed / size), unit);
};

export const exactTime = (timestamp: string, locale?: string, timeZone?: string): string => {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return UNKNOWN_EXACT;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(timeZone === undefined ? {} : {timeZone}),
  }).format(parsed);
};

export const pageTimestamp = (page: PageSummary): PageTimestamp => {
  const latest = page.latestAudit;

  if (latest === null) {
    return {value: page.createdAt, prefix: 'Added'};
  }

  // A scheduled audit is queued for hours before it runs, so "Audit started"
  // beside a future slot claims two contradictory things. Until it starts, the
  // last finished audit is what this page was last measured by.
  if (latest.status === 'queued' && page.nextAuditAt !== null) {
    const finished = page.history.at(-1);
    return finished === undefined ? {value: page.createdAt, prefix: 'Added'} : {value: finished.at, prefix: 'Audited'};
  }

  if (latest.status === 'done') {
    return {value: latest.completedAt ?? latest.createdAt, prefix: 'Audited'};
  }

  if (latest.status === 'failed') {
    return {value: latest.completedAt ?? latest.createdAt, prefix: 'Attempted'};
  }

  return {value: latest.createdAt, prefix: 'Audit started'};
};

const dayKey = (at: number, timeZone?: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(timeZone === undefined ? {} : {timeZone}),
  }).format(at);

export const nextAuditTime = (
  timestamp: string,
  now: number = Date.now(),
  locale?: string,
  timeZone?: string,
): string => {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return UNKNOWN_RELATIVE;
  }

  const zone = timeZone === undefined ? {} : {timeZone};
  // Named zone, not a bare clock: "at 05:30" is unreadable to anyone who
  // cannot tell whose 05:30 it is, and the schedule itself is set in UTC.
  const clock = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    ...zone,
  }).format(parsed);
  // Differenced as calendar dates rather than by adding 24 hours: a local day
  // is 23 or 25 hours long across a DST change, so "now + DAY" lands on today
  // or on the day after tomorrow and an audit due tomorrow loses its clock
  // time. Both keys are plain YYYY-MM-DD, so parsing them is exact.
  const days = (Date.parse(dayKey(parsed, timeZone)) - Date.parse(dayKey(now, timeZone))) / DAY;

  if (days <= 0) {
    return `at ${clock}`;
  }
  if (days === 1) {
    return `tomorrow at ${clock}`;
  }

  return `on ${new Intl.DateTimeFormat(locale, {dateStyle: 'medium', ...zone}).format(parsed)}`;
};
