import type {AuditStatus} from '../models/audit.js';
import {utcDayStart} from './utc-day.js';

export const JITTER_WINDOW_MS = 6 * 60 * 60 * 1000;

export const SAME_DOMAIN_STAGGER_MS = 60_000;

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

const fnv1a = (value: string): number => {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
};

export const reauditDelayMs = (
  domain: string,
  pageId: string,
  windowMs: number = JITTER_WINDOW_MS,
  staggerMs: number = SAME_DOMAIN_STAGGER_MS,
): number => {
  const slots = Math.max(1, Math.floor(windowMs / staggerMs));
  const slot = fnv1a(pageId) % slots;
  return (fnv1a(domain) + slot * staggerMs) % windowMs;
};

export {utcDay, utcDayStart} from './utc-day.js';

export const REAUDIT_RUN_HOUR_UTC = 2;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type ReauditLatestAudit = {
  status: AuditStatus;
  createdAt: Date;
  scheduledFor: Date | null;
};

export type ReauditSubject = {
  domain: string;
  pageId: string;
  monitoringEnabled: boolean;
  latest: ReauditLatestAudit | null;
};

const slotOn = (dayStart: Date, domain: string, pageId: string): Date =>
  new Date(dayStart.getTime() + REAUDIT_RUN_HOUR_UTC * HOUR_MS + reauditDelayMs(domain, pageId));

export const nextReauditAt = ({domain, pageId, monitoringEnabled, latest}: ReauditSubject, now: Date): Date | null => {
  if (latest?.status === 'running') {
    return null;
  }

  if (latest?.status === 'queued') {
    return latest.scheduledFor === null ? null : new Date(latest.createdAt.getTime() + reauditDelayMs(domain, pageId));
  }

  if (!monitoringEnabled) {
    return null;
  }

  const dayStart = utcDayStart(now);
  const today = slotOn(dayStart, domain, pageId);

  if (today > now && (latest === null || latest.createdAt < dayStart)) {
    return today;
  }

  return slotOn(new Date(dayStart.getTime() + DAY_MS), domain, pageId);
};
