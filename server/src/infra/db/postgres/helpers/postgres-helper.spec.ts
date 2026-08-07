import {afterEach, describe, expect, it, vi} from 'vitest';
import {sql, type Kysely} from 'kysely';
import {makeDatabase} from './postgres-helper.js';
import type {Database} from '../database.js';

const connectionString = (): string => {
  const url = process.env.DATABASE_URL;
  if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup');
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

      await expect(sql`select 1`.execute(destroyed)).rejects.toThrow();
    } finally {
      // destroy() throws if the pool was already destroyed above; that's
      // expected on the happy path, so swallow it here - this is only a
      // safety net for a failure before the intentional destroy() runs.
      await destroyed.destroy().catch(() => {});
    }
  });

  it('survives an idle backend being terminated instead of crashing the process', async () => {
    const primary = makeDatabase(connectionString());
    const terminator = makeDatabase(connectionString());
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const pidResult = await sql<{pid: number}>`select pg_backend_pid() as pid`.execute(primary);
      const pid = pidResult.rows[0]?.pid;
      expect(typeof pid).toBe('number');

      // Kill the primary pool's now-idle connection from a second connection,
      // the same way the OS/Postgres does when a container is stopped or a
      // backend is reaped. Without a pool-level 'error' handler in
      // makeDatabase, the idle client's unhandled 'error' event would crash
      // this whole test process rather than just failing an assertion.
      const terminateResult = await sql<{pg_terminate_backend: boolean}>`select pg_terminate_backend(${pid})`.execute(
        terminator,
      );
      expect(terminateResult.rows[0]?.pg_terminate_backend).toBe(true);

      // The idle client detects the dead socket asynchronously, off any query
      // path. Poll for the pool's error handler instead of a fixed sleep.
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

    // pg_sleep holds the backend without taking a lock, so what fires here is
    // the timeout rather than contention with anything else in the suite.
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

    // A pool hands out a separate backend per connection. A timeout applied
    // once at construction, rather than to each connection as it opens, would
    // bind only whichever backend happened to run first.
    const results = await Promise.allSettled(
      [0, 1, 2].map(async () => await sql`select pg_sleep(5)`.execute(db as Kysely<Database>)),
    );

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
  });

  it('leaves statements unbounded when no timeout is configured', async () => {
    // Migrations go through this factory and build indexes that legitimately
    // outrun any sane statement timeout; being cancelled halfway is the one
    // failure they must not have. This pins that exclusion rather than
    // leaving it to a comment - see #52.
    db = makeDatabase(connectionString());

    const result = await sql<{statement_timeout: string}>`show statement_timeout`.execute(db);

    expect(result.rows[0]?.statement_timeout).toBe('0');
  });
});
