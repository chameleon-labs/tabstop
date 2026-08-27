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
      await sql`select 1`.execute(destroyed);
      await destroyed.destroy();
      const sut = new PostgresHealthAdapter(destroyed);

      await expect(sut.isReachable()).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalledWith('Postgres health check failed:', expect.any(Error));
    } finally {
      await destroyed.destroy().catch(() => undefined);
    }
  });

  it('reports unhealthy rather than throwing when its probe is cancelled', async () => {
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
