import {afterEach, describe, expect, it, vi} from 'vitest';
import request from 'supertest';
import {setupApp} from './app.js';
import {connectDatabase, disconnectDatabase} from './database.js';
import {closeRateLimiter} from '../factories/middlewares/rate-limit-factory.js';
import {MemoryTokenBucket} from '../../infra/rate-limit/memory-token-bucket.js';
import type {AuditJobQueue} from '../../data/protocols/queue/audit-job-queue.js';
import type * as envModule from './env.js';

// oxlint-disable-next-line no-constant-condition -- a compile-only assertion; the block must never run
if (false) {
  // @ts-expect-error partial composition must not fall through to globals
  setupApp({rateLimiter: new MemoryTokenBucket()});
}

const connectionString = (): string => {
  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    throw new Error('DATABASE_URL not set by globalSetup');
  }
  return url;
};

describe('setupApp', () => {
  afterEach(async () => {
    await disconnectDatabase();
    await closeRateLimiter();
  });

  it('sets trust proxy to the configured hop count, not `true`', async () => {
    vi.resetModules();
    const actual = await vi.importActual<typeof envModule>('./env.js');
    vi.doMock('./env.js', () => ({...actual, env: {...actual.env, trustProxyHops: 0}}));

    const database = await import('./database.js');
    database.connectDatabase(connectionString());

    try {
      const {setupApp: setupAppWithStubbedEnv} = await import('./app.js');
      const app = setupAppWithStubbedEnv();

      expect(app.get('trust proxy')).toBe(0);
    } finally {
      await database.disconnectDatabase();
      const rateLimitFactory = await import('../factories/middlewares/rate-limit-factory.js');
      await rateLimitFactory.closeRateLimiter();
      vi.doUnmock('./env.js');
      vi.resetModules();
    }
  });

  it('reads the hop count from env rather than hardcoding it', async () => {
    vi.resetModules();
    const actual = await vi.importActual<typeof envModule>('./env.js');
    vi.doMock('./env.js', () => ({...actual, env: {...actual.env, trustProxyHops: 3}}));

    const database = await import('./database.js');
    database.connectDatabase(connectionString());

    try {
      const {setupApp: setupAppWithStubbedEnv} = await import('./app.js');
      const app = setupAppWithStubbedEnv();

      expect(app.get('trust proxy')).toBe(3);
    } finally {
      await database.disconnectDatabase();
      const rateLimitFactory = await import('../factories/middlewares/rate-limit-factory.js');
      await rateLimitFactory.closeRateLimiter();
      vi.doUnmock('./env.js');
      vi.resetModules();
    }
  });

  it('uses supplied dependencies for guarded routes', async () => {
    const rateLimiter = new MemoryTokenBucket();
    const consume = vi.spyOn(rateLimiter, 'consume');
    const auditQueue: AuditJobQueue = {
      enqueueOnce: () => Promise.resolve(undefined),
      has: () => Promise.resolve(false),
      isPending: () => Promise.resolve(false),
      backlogCount: () => Promise.resolve(0),
    };

    connectDatabase(connectionString());
    const app = setupApp({rateLimiter, auditQueue});

    const response = await request(app).post('/api/audits').send({});

    expect(response.status).toBe(400);
    expect(consume).toHaveBeenCalledOnce();
  });
});
