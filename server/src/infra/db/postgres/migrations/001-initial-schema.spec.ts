import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql, type Kysely } from 'kysely'
import { makeDatabase } from '../helpers/postgres-helper.js'
import type { Database } from '../database.js'

describe('001-initial-schema', () => {
  let db: Kysely<Database>

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('creates all five tables', async () => {
    const result = await sql<{ table_name: string }>`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('sites','pages','audits','violations','alert_events')
      order by table_name
    `.execute(db)

    expect(result.rows.map(row => row.table_name))
      .toEqual(['alert_events', 'audits', 'pages', 'sites', 'violations'])
  })

  it('creates the indexes the read paths depend on', async () => {
    const result = await sql<{ indexname: string }>`
      select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'audits_public_uuid_idx',
          'audits_page_created_idx',
          'violations_audit_idx',
          'alert_events_one_per_page_per_day'
        )
      order by indexname
    `.execute(db)

    expect(result.rows.map(row => row.indexname)).toEqual([
      'alert_events_one_per_page_per_day',
      'audits_page_created_idx',
      'audits_public_uuid_idx',
      'violations_audit_idx'
    ])
  })

  it('rejects an audit whose counts_by_impact is missing keys', async () => {
    const insertPartialCounts = sql`
      insert into audits (url, status, counts_by_impact)
      values ('https://partial.test', 'queued', '{"minor":1}'::jsonb)
    `.execute(db)

    await expect(insertPartialCounts).rejects.toThrow(/audits_counts_complete_check/)
  })

  it('rejects an audit with an unknown status', async () => {
    const insertBadStatus = sql`
      insert into audits (url, status) values ('https://bad.test', 'nonsense')
    `.execute(db)

    await expect(insertBadStatus).rejects.toThrow(/audits_status_check/)
  })
})
