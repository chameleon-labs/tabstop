import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Kysely} from 'kysely';
import {makeDatabase} from '../helpers/postgres-helper.js';
import type {Database} from '../database.js';
import {PostgresAccountRepository} from './postgres-account-repository.js';
import {PostgresSessionRepository} from '../session/postgres-session-repository.js';

describe('PostgresAccountRepository', () => {
  let db: Kysely<Database>;
  let sut: PostgresAccountRepository;
  let sessions: PostgresSessionRepository;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    db = makeDatabase(url);
    sut = new PostgresAccountRepository(db);
    sessions = new PostgresSessionRepository(db);
  });

  afterAll(async () => {
    await db.destroy();
  });

  const newEmail = (): string => `${randomUUID()}@test.test`;

  describe('add', () => {
    it('creates an account with the default alert threshold', async () => {
      const email = newEmail();

      const account = await sut.add({email, passwordDigest: 'digest'});

      expect(account).toEqual({
        id: expect.any(String),
        email,
        alertThreshold: 5,
        createdAt: expect.any(Date),
      });
    });

    it('never exposes the digest on the model', async () => {
      const account = await sut.add({email: newEmail(), passwordDigest: 'secret-digest'});

      expect(JSON.stringify(account)).not.toContain('secret-digest');
    });

    it('returns null when the email is already registered', async () => {
      const email = newEmail();
      await sut.add({email, passwordDigest: 'a'});

      expect(await sut.add({email, passwordDigest: 'b'})).toBeNull();
    });

    it('returns null for the loser of a concurrent insert, rather than throwing', async () => {
      const email = newEmail();

      const results = await Promise.all([
        sut.add({email, passwordDigest: 'a'}),
        sut.add({email, passwordDigest: 'b'}),
        sut.add({email, passwordDigest: 'c'}),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(results.filter((result) => result === null)).toHaveLength(2);
    });
  });

  describe('loadByEmail', () => {
    it('returns the account beside its digest', async () => {
      const email = newEmail();
      await sut.add({email, passwordDigest: 'the-digest'});

      const found = await sut.loadByEmail(email);

      expect(found?.passwordDigest).toBe('the-digest');
      expect(found?.account.email).toBe(email);
    });

    it('returns null for an unknown email', async () => {
      expect(await sut.loadByEmail(newEmail())).toBeNull();
    });
  });

  describe('loadBySessionId', () => {
    const makeAccountWithSession = async (
      expiresAt: Date,
    ): Promise<{
      account: Awaited<ReturnType<PostgresAccountRepository['add']>>;
      sessionId: string;
    }> => {
      const account = await sut.add({email: newEmail(), passwordDigest: 'd'});
      if (account === null) {
        throw new Error('fixture failed to create an account');
      }
      const sessionId = randomUUID();
      await sessions.add({id: sessionId, userId: account.id, expiresAt});
      return {account, sessionId};
    };

    it('returns the account behind a live session', async () => {
      const {account, sessionId} = await makeAccountWithSession(new Date(Date.now() + 60_000));

      expect(await sut.loadBySessionId(sessionId)).toEqual(account);
    });

    it('returns null for an expired session', async () => {
      const {sessionId} = await makeAccountWithSession(new Date(Date.now() - 1000));

      expect(await sut.loadBySessionId(sessionId)).toBeNull();
    });

    it('returns null for an unknown session id', async () => {
      expect(await sut.loadBySessionId(randomUUID())).toBeNull();
    });
  });
});
