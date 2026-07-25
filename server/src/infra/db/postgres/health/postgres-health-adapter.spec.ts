import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql, type Kysely } from 'kysely'
import { PostgresHealthAdapter } from './postgres-health-adapter.js'
import { makeDatabase } from '../helpers/postgres-helper.js'
import type { Database } from '../database.js'

const connectionString = (): string => {
  const url = process.env.DATABASE_URL
  if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
  return url
}

describe('PostgresHealthAdapter', () => {
  let db: Kysely<Database>

  beforeAll(() => {
    db = makeDatabase(connectionString())
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('returns true against a reachable database', async () => {
    const sut = new PostgresHealthAdapter(db)

    await expect(sut.isReachable()).resolves.toBe(true)
  })

  it('returns false instead of throwing when the pool is destroyed', async () => {
    const destroyed = makeDatabase(connectionString())
    try {
      // Kysely 0.29.4 lazily initialises its driver on first query; destroying
      // a pool that has never run a query is a silent no-op. Run one first so
      // destroy() actually tears down a live connection.
      await sql`select 1`.execute(destroyed)
      await destroyed.destroy()
      const sut = new PostgresHealthAdapter(destroyed)

      await expect(sut.isReachable()).resolves.toBe(false)
    } finally {
      // destroy() throws if the pool was already destroyed above; that's
      // expected on the happy path, so swallow it here - this is only a
      // safety net for a failure before the intentional destroy() runs.
      await destroyed.destroy().catch(() => {})
    }
  })

  it('returns false when the connection string points nowhere', async () => {
    const unreachable = makeDatabase('postgres://nobody:nobody@127.0.0.1:1/none')
    const sut = new PostgresHealthAdapter(unreachable)

    try {
      await expect(sut.isReachable()).resolves.toBe(false)
    } finally {
      await unreachable.destroy()
    }
  })
})
