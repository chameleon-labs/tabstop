import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {sql, type Kysely} from 'kysely';
import type {Database} from '../database.js';
import {makeDatabase} from '../helpers/postgres-helper.js';

describe('008 alert delivery', () => {
  let db: Kysely<Database>;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup');
    db = makeDatabase(url);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('keeps email alerts separate from page monitoring', async () => {
    const result = await sql<{column_default: string; is_nullable: string}>`
      select column_default, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'pages'
        and column_name = 'alerts_enabled'
    `.execute(db);

    expect(result.rows).toEqual([{column_default: 'true', is_nullable: 'NO'}]);
  });

  it('indexes only unsent events for the delivery dispatcher', async () => {
    const result = await sql<{indexdef: string}>`
      select indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'alert_events_unsent_idx'
    `.execute(db);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.indexdef).toContain('(id)');
    expect(result.rows[0]?.indexdef).toContain('emailed_at IS NULL');
  });
});
