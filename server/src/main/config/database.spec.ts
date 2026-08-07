import {afterEach, describe, expect, it} from 'vitest';
import {sql} from 'kysely';
import {connectDatabase, disconnectDatabase, getDatabase} from './database.js';

const connectionString = (): string => {
  const url = process.env.DATABASE_URL;
  if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup');
  return url;
};

describe('database composition root', () => {
  afterEach(async () => {
    await disconnectDatabase();
  });

  it('throws when getDatabase is called before connecting', () => {
    expect(() => getDatabase()).toThrow('not connected');
  });

  it('returns the same instance it connected', () => {
    const connected = connectDatabase(connectionString());

    expect(getDatabase()).toBe(connected);
  });

  it('returns a usable instance', async () => {
    connectDatabase(connectionString());

    const result = await sql<{one: number}>`select 1 as one`.execute(getDatabase());

    expect(result.rows[0]?.one).toBe(1);
  });

  it('refuses to reconnect while already connected, rather than stranding the old pool', () => {
    connectDatabase(connectionString());

    expect(() => connectDatabase(connectionString())).toThrow('already connected');
  });

  it('allows reconnecting after an explicit disconnect', async () => {
    const first = connectDatabase(connectionString());
    await disconnectDatabase();

    const second = connectDatabase(connectionString());

    expect(second).not.toBe(first);
    expect(getDatabase()).toBe(second);
  });

  it('leaves no instance behind after disconnecting', async () => {
    connectDatabase(connectionString());

    await disconnectDatabase();

    expect(() => getDatabase()).toThrow('not connected');
  });

  it('is safe to disconnect when never connected', async () => {
    await expect(disconnectDatabase()).resolves.toBeUndefined();
  });

  it('bounds statements on the pool that serves requests and jobs', async () => {
    // This is the composition root for both the API and the worker, so it is
    // the one place that decides whether a query has any bound at all once it
    // has started. Migrations deliberately get no timeout; everything routed
    // through here must (#52).
    connectDatabase(connectionString());

    const result = await sql<{statement_timeout: string}>`
      show statement_timeout
    `.execute(getDatabase());

    expect(result.rows[0]?.statement_timeout).not.toBe('0');
  });
});
