import {afterEach, describe, expect, it, vi} from 'vitest';
import {sql, type Kysely} from 'kysely';
import {makeDatabase} from './postgres-helper.js';
import type {Database} from '../database.js';

const connectionString = (): string => {
  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    throw new Error('DATABASE_URL not set by globalSetup');
  }
  return url;
};

describe('makeDatabase', () => {
  let db: Kysely<Database> | null = null;

  afterEach(async () => {
    await db?.destroy();
    db = null;
  });

  it('returns an instance that can execute a query', async () => {
    db = makeDatabase(connectionString());

    const result = await sql<{one: number}>`select 1 as one`.execute(db);

    expect(result.rows[0]?.one).toBe(1);
  });

  it('rejects queries once destroyed', async () => {
    const destroyed = makeDatabase(connectionString());
    try {
      await sql`select 1`.execute(destroyed);
      await destroyed.destroy();

      await expect(sql`select 1`.execute(destroyed)).rejects.toThrow(Error);
    } finally {
      await destroyed.destroy().catch(() => undefined);
    }
  });

  it('survives an idle backend being terminated instead of crashing the process', async () => {
    const primary = makeDatabase(connectionString());
    const terminator = makeDatabase(connectionString());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const pidResult = await sql<{pid: number}>`select pg_backend_pid() as pid`.execute(primary);
      const pid = pidResult.rows[0]?.pid;
      expect(typeof pid).toBe('number');

      const terminateResult = await sql<{pg_terminate_backend: boolean}>`select pg_terminate_backend(${pid})`.execute(
        terminator,
      );
      expect(terminateResult.rows[0]?.pg_terminate_backend).toBe(true);

      await vi.waitFor(
        () => {
          expect(errorSpy).toHaveBeenCalledWith('Postgres pool error (connection dropped):', expect.any(String));
        },
        {timeout: 2000, interval: 20},
      );

      const result = await sql<{one: number}>`select 1 as one`.execute(primary);
      expect(result.rows[0]?.one).toBe(1);
    } finally {
      errorSpy.mockRestore();
      await primary.destroy();
      await terminator.destroy();
    }
  });
});

const QUERY_CANCELED = '57014';

describe('makeDatabase statement timeout', () => {
  let db: Kysely<Database> | null = null;

  afterEach(async () => {
    await db?.destroy();
    db = null;
  });

  it('cancels a statement that runs past the timeout', async () => {
    db = makeDatabase(connectionString(), {statementTimeoutMs: 250});

    await expect(sql`select pg_sleep(5)`.execute(db)).rejects.toMatchObject({
      code: QUERY_CANCELED,
    });
  });

  it('leaves a statement that finishes inside the timeout alone', async () => {
    db = makeDatabase(connectionString(), {statementTimeoutMs: 5000});

    const result = await sql<{one: number}>`select 1 as one`.execute(db);

    expect(result.rows[0]?.one).toBe(1);
  });

  it('bounds every connection in the pool, not only the first', async () => {
    db = makeDatabase(connectionString(), {statementTimeoutMs: 250});

    const results = await Promise.allSettled(
      [0, 1, 2].map(async () => await sql`select pg_sleep(5)`.execute(db as Kysely<Database>)),
    );

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });

  it('leaves statements unbounded when no timeout is configured', async () => {
    db = makeDatabase(connectionString());

    const result = await sql<{statement_timeout: string}>`show statement_timeout`.execute(db);

    expect(result.rows[0]?.statement_timeout).toBe('0');
  });
});
