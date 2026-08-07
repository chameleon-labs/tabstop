import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Kysely} from 'kysely';
import {makeDatabase} from '../helpers/postgres-helper.js';
import type {Database} from '../database.js';
import {PostgresSessionRepository} from './postgres-session-repository.js';

describe('PostgresSessionRepository', () => {
  let db: Kysely<Database>;
  let sut: PostgresSessionRepository;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    db = makeDatabase(url);
    sut = new PostgresSessionRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const makeUserId = async (): Promise<string> => {
    const user = await db
      .insertInto('users')
      .values({email: `${randomUUID()}@test.test`, password_digest: 'x'})
      .returning('id')
      .executeTakeFirstOrThrow();
    return user.id;
  };

  describe('add', () => {
    it('stores a session and returns it with the persisted expiry', async () => {
      const userId = await makeUserId();
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + 3600_000);

      const session = await sut.add({id, userId, expiresAt});

      expect(session).toEqual({
        id,
        userId,
        createdAt: expect.any(Date),
        expiresAt,
      });
    });
  });

  describe('deleteById', () => {
    it('deletes a session by id', async () => {
      const userId = await makeUserId();
      const id = randomUUID();
      await sut.add({id, userId, expiresAt: new Date(Date.now() + 60_000)});

      await sut.deleteById(id);

      const rows = await db.selectFrom('sessions').select('id').where('id', '=', id).execute();
      expect(rows).toEqual([]);
    });

    it('treats deleting an unknown id as a no-op', async () => {
      // Logout is idempotent, so this must not throw.
      await expect(sut.deleteById(randomUUID())).resolves.toBeUndefined();
    });
  });

  describe('deleteExpired', () => {
    /**
     * Expiry was enforced in the lookup query - `expires_at > now()` - so an
     * expired row was already harmless. It was never removed, though, so the
     * table only ever grew: one row per login, forever, including for accounts
     * that never come back. Correct and unbounded is still a problem, and the
     * fix has to be a delete rather than a stricter read.
     */
    it('removes sessions that have expired and keeps the live ones', async () => {
      const userId = await makeUserId();
      const expired = randomUUID();
      const live = randomUUID();
      await sut.add({id: expired, userId, expiresAt: new Date(Date.now() - 1000)});
      await sut.add({id: live, userId, expiresAt: new Date(Date.now() + 60_000)});

      const removed = await sut.deleteExpired();

      expect(removed).toBeGreaterThanOrEqual(1);
      const remaining = await db.selectFrom('sessions').select('id').where('id', 'in', [expired, live]).execute();
      expect(remaining.map((row) => row.id)).toEqual([live]);
    });

    it("compares against the DATABASE clock, not this process's", async () => {
      // The discriminating part is moving the APPLICATION clock and leaving
      // Postgres's alone. Merely inserting a session that expires in a minute
      // and watching it survive proves nothing: a `new Date()` implementation
      // preserves it too, so the spec would pass against the very bug it
      // exists to catch.
      //
      // With the process an hour ahead, the two implementations disagree -
      // `new Date()` deletes a row that is still live, `now()` keeps it. That
      // is the real hazard: app clocks drift between instances, so a sweeper
      // on the fast one would revoke sessions the slow one still honours, and
      // users would be logged out at random by whichever box swept last.
      const userId = await makeUserId();
      const id = randomUUID();
      await sut.add({id, userId, expiresAt: new Date(Date.now() + 60_000)});

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date(Date.now() + 3_600_000));
        await sut.deleteExpired();
      } finally {
        vi.useRealTimers();
      }

      const rows = await db.selectFrom('sessions').select('id').where('id', '=', id).execute();
      expect(rows).toHaveLength(1);
    });

    it('counts the rows it removed, as a finite number', async () => {
      // Deliberately NOT asserting an exact total. Every spec in this suite
      // shares one Postgres container, vitest runs files in parallel, and two
      // other files insert already-expired sessions - so a table-wide count
      // is somebody else's row as often as it is ours. Scoped to rows this
      // test owns, which is the same lesson as the audit-routes flake.
      //
      // The finiteness check is not ceremony: numDeletedRows is a bigint, and
      // Number(undefined) is NaN, so a change to that conversion would return
      // a value that passes every >= assertion ever written against it.
      const userId = await makeUserId();
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of ids) {
        await sut.add({id, userId, expiresAt: new Date(Date.now() - 1000)});
      }

      const removed = await sut.deleteExpired();

      expect(Number.isFinite(removed)).toBe(true);
      expect(removed).toBeGreaterThanOrEqual(ids.length);
      const remaining = await db.selectFrom('sessions').select('id').where('id', 'in', ids).execute();
      expect(remaining).toEqual([]);
    });
  });
});
