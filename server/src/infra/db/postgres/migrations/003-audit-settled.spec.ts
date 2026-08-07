import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {Kysely} from 'kysely';
import {makeDatabase} from '../helpers/postgres-helper.js';
import type {Database} from '../database.js';

describe('audits.settled', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup');
    db = makeDatabase(url);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('defaults to true, so an audit that has never run is not marked suspect', async () => {
    const row = await db
      .insertInto('audits')
      .values({page_id: null, url: `https://${randomUUID()}.test/x`, status: 'queued'})
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(row.settled).toBe(true);
  });

  it('records an audit that ran against a page which never finished loading', async () => {
    const row = await db
      .insertInto('audits')
      .values({
        page_id: null,
        url: `https://${randomUUID()}.test/x`,
        status: 'done',
        settled: false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(row.settled).toBe(false);
  });
});
