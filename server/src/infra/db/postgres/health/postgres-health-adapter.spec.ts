import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {sql, type Kysely} from 'kysely';
import {DatabaseError} from 'pg';
import {PostgresHealthAdapter} from './postgres-health-adapter.js';
import {makeDatabase} from '../helpers/postgres-helper.js';
import type {Database} from '../database.js';

const connectionString = (): string => {
  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    throw new Error('DATABASE_URL not set by globalSetup');
  }
  return url;
};

describe('PostgresHealthAdapter', () => {
  let db: Kysely<Database>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    db = makeDatabase(connectionString());
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    // Two of these tests provoke the failure path on purpose, and the adapter
    // logs the diagnosis by design. Silence it so a passing run doesn't print
    // alarming stderr in CI, and assert on the spy instead - the logging is
    // part of the adapter's contract, so it's worth pinning rather than hiding.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('returns true against a reachable database', async () => {
    const sut = new PostgresHealthAdapter(db);

    await expect(sut.isReachable()).resolves.toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns false instead of throwing when the pool is destroyed', async () => {
    const destroyed = makeDatabase(connectionString());
    try {
      // Kysely 0.29.4 lazily initialises its driver on first query; destroying
      // a pool that has never run a query is a silent no-op. Run one first so
      // destroy() actually tears down a live connection.
      await sql`select 1`.execute(destroyed);
      await destroyed.destroy();
      const sut = new PostgresHealthAdapter(destroyed);

      await expect(sut.isReachable()).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalledWith('Postgres health check failed:', expect.any(Error));
    } finally {
      // destroy() throws if the pool was already destroyed above; that's
      // expected on the happy path, so swallow it here - this is only a
      // safety net for a failure before the intentional destroy() runs.
      await destroyed.destroy().catch(() => undefined);
    }
  });

  it('reports unhealthy rather than throwing when its probe is cancelled', async () => {
    // With a statement_timeout on the production pool (#52) the probe becomes
    // cancellable, so this adapter starts seeing 57014 where it previously
    // only saw connection failures. A cancelled probe must degrade to a 503
    // the caller can answer with, not escape as a crash.
    //
    // Driven through a stub rather than a real timeout on purpose: the probe
    // is `select 1`, which no honest statement_timeout is short enough to
    // cancel, so provoking this against real Postgres would mean a 1ms bound
    // and a test that fails whenever CI is busy. The error is a genuine
    // pg.DatabaseError carrying the real SQLSTATE, so what is faked is the
    // timing, not the failure being handled.
    const queryCanceled = Object.assign(new DatabaseError('canceling statement due to statement timeout', 0, 'error'), {
      code: '57014',
    });
    const cancelling = {
      getExecutor: () => {
        throw queryCanceled;
      },
    } as unknown as Kysely<Database>;
    const sut = new PostgresHealthAdapter(cancelling);

    await expect(sut.isReachable()).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith('Postgres health check failed:', queryCanceled);
  });

  it('returns false when the connection string points nowhere', async () => {
    const unreachable = makeDatabase('postgres://nobody:nobody@127.0.0.1:1/none');
    const sut = new PostgresHealthAdapter(unreachable);

    try {
      await expect(sut.isReachable()).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalledWith('Postgres health check failed:', expect.any(Error));
    } finally {
      await unreachable.destroy();
    }
  });
});
