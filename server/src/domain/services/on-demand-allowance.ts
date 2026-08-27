import {utcDayStart} from './utc-day.js';

export const ON_DEMAND_AUDITS_PER_DAY = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export const nextAllowanceAt = (now: Date): Date => new Date(utcDayStart(now).getTime() + DAY_MS);
