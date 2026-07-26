import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql, type Kysely } from 'kysely'
import { makeDatabase } from '../helpers/postgres-helper.js'
import { runMigrations } from './migrator.js'
import type { Database } from '../database.js'

describe('runMigrations', () => {
  let db: Kysely<Database>

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
  })

  afterAll(async () => {
    await db.destroy()
  })

  const bookkeepingTables = async (): Promise<string[]> => {
    const result = await sql<{ table_name: string }>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name like 'kysely_migration%'
      order by table_name
    `.execute(db)
    return result.rows.map(row => row.table_name)
  }

  it('creates the bookkeeping tables', async () => {
    await runMigrations(db)

    expect(await bookkeepingTables()).toEqual(['kysely_migration', 'kysely_migration_lock'])
  })

  it('records every registered migration in the bookkeeping table', async () => {
    await runMigrations(db)

    const result = await sql<{ name: string }>`
      select name from kysely_migration order by name
    `.execute(db)

    expect(result.rows.map(row => row.name)).toEqual(['001-initial-schema'])
  })

  it('returns no results when every migration is already applied', async () => {
    await runMigrations(db)

    const results = await runMigrations(db)

    expect(results).toEqual([])
  })

  it('is idempotent across repeated runs', async () => {
    await runMigrations(db)
    await runMigrations(db)

    expect(await bookkeepingTables()).toEqual(['kysely_migration', 'kysely_migration_lock'])
  })
})
