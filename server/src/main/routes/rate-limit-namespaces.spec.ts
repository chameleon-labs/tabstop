import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {Router} from 'express';
import type {BucketConfig, RateLimitAllowance, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';
import type {AuditJobQueue} from '../../data/protocols/queue/audit-job-queue.js';
import type {RateLimitRule} from '../middlewares/rate-limit.js';
import type * as rateLimitMiddleware from '../middlewares/rate-limit.js';
import {RATE_LIMITS} from '../config/rate-limits.js';

const recorded: RateLimitRule[] = [];
const recordedLimiters: RateLimiter[] = [];

vi.mock('../middlewares/rate-limit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof rateLimitMiddleware>();
  return {
    ...actual,
    makeRateLimit: (limiter: Parameters<typeof actual.makeRateLimit>[0], rules: RateLimitRule[]) => {
      recorded.push(...rules);
      recordedLimiters.push(limiter);
      return actual.makeRateLimit(limiter, rules);
    },
  };
});

const recordingRouter = (): Router => {
  const router = {} as Router;
  const noop = (): Router => router;
  return Object.assign(router, {
    get: noop,
    post: noop,
    put: noop,
    patch: noop,
    delete: noop,
    use: noop,
  });
};

const allowed: RateLimitAllowance = {
  allowed: true,
  remaining: 1,
  refund: () => Promise.resolve(undefined),
};

const rateLimiter: RateLimiter = {
  consume: () => Promise.resolve(allowed),
};

const auditQueue: AuditJobQueue = {
  enqueueOnce: () => Promise.resolve(undefined),
  has: () => Promise.resolve(false),
  isPending: () => Promise.resolve(false),
  backlogCount: () => Promise.resolve(0),
};

const collectRules = async (): Promise<RateLimitRule[]> => {
  recorded.length = 0;
  recordedLimiters.length = 0;

  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    throw new Error('DATABASE_URL not set by globalSetup');
  }

  const database = await import('../config/database.js');
  database.connectDatabase(url);

  try {
    const accountRoutes = (await import('./account-routes.js')).setupAccountRoutes;
    const auditRoutes = (await import('./audit-routes.js')).setupAuditRoutes;
    const healthCheckRoutes = (await import('./health-check-routes.js')).setupHealthCheckRoutes;
    const pageRoutes = (await import('./page-routes.js')).setupPageRoutes;
    const alertRoutes = (await import('./alert-routes.js')).setupAlertRoutes;

    accountRoutes(recordingRouter(), rateLimiter);
    auditRoutes(recordingRouter(), rateLimiter, auditQueue);
    healthCheckRoutes(recordingRouter());
    pageRoutes(recordingRouter(), rateLimiter, auditQueue);
    alertRoutes(recordingRouter(), rateLimiter);
    return [...recorded];
  } finally {
    await database.disconnectDatabase();
  }
};

describe('rate limit namespaces', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('gives every rule in the route table its own name', async () => {
    const names = (await collectRules()).map((rule) => rule.name);

    expect(names.length).toBeGreaterThan(0);
    expect([...new Set(names)]).toHaveLength(names.length);
  });

  it('uses the supplied limiter for every guarded route', async () => {
    await collectRules();

    expect(recordedLimiters).not.toHaveLength(0);
    expect(recordedLimiters.every((limiter) => limiter === rateLimiter)).toBe(true);
  });

  it('never lets one name stand for two different buckets', async () => {
    const byName = new Map<string, BucketConfig>();

    for (const rule of await collectRules()) {
      const seen = byName.get(rule.name) ?? rule.bucket;
      expect(rule.bucket).toEqual(seen);
      byName.set(rule.name, rule.bucket);
    }
  });

  it('names every rule after a bucket that actually exists', async () => {
    const known: string[] = Object.keys(RATE_LIMITS);

    for (const rule of await collectRules()) {
      expect(known).toContain(rule.name);
    }
  });
});
