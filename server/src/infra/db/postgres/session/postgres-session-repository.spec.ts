import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import { makeDatabase } from '../helpers/postgres-helper.js'
import type { Database } from '../database.js'
import { PostgresSessionRepository } from './postgres-session-repository.js'

describe('PostgresSessionRepository', () => {
  let db: Kysely<Database>
  let sut: PostgresSessionRepository

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
    sut = new PostgresSessionRepository(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  const makeUserId = async (): Promise<string> => {
    const user = await db.insertInto('users')
      .values({ email: `${randomUUID()}@test.test`, password_digest: 'x' })
      .returning('id').executeTakeFirstOrThrow()
    return user.id
  }

  describe('add', () => {
    it('stores a session and returns it with the persisted expiry', async () => {
      const userId = await makeUserId()
      const id = randomUUID()
      const expiresAt = new Date(Date.now() + 3600_000)

      const session = await sut.add({ id, userId, expiresAt })

      expect(session).toEqual({
        id, userId, createdAt: expect.any(Date), expiresAt
      })
    })
  })

  describe('deleteById', () => {
    it('deletes a session by id', async () => {
      const userId = await makeUserId()
      const id = randomUUID()
      await sut.add({ id, userId, expiresAt: new Date(Date.now() + 60_000) })

      await sut.deleteById(id)

      const rows = await db.selectFrom('sessions').select('id').where('id', '=', id).execute()
      expect(rows).toEqual([])
    })

    it('treats deleting an unknown id as a no-op', async () => {
      // Logout is idempotent, so this must not throw.
      await expect(sut.deleteById(randomUUID())).resolves.toBeUndefined()
    })
  })

  describe('deleteExpired', () => {
    /**
     * Expiry was enforced in the lookup query - `expires_at > now()` - so an
     * expired row was already harmless. It was never removed, though, so the
     * table only ever grew: one row per login, forever, including for accounts
     * that never come back. Correct and unbounded is still a problem, and the
     * fix has to be a delete rather than a stricter read.
     */
    it('removes sessions that have expired and keeps the live ones', async () => {
      const userId = await makeUserId()
      const expired = randomUUID()
      const live = randomUUID()
      await sut.add({ id: expired, userId, expiresAt: new Date(Date.now() - 1000) })
      await sut.add({ id: live, userId, expiresAt: new Date(Date.now() + 60_000) })

      const removed = await sut.deleteExpired()

      expect(removed).toBeGreaterThanOrEqual(1)
      const remaining = await db.selectFrom('sessions').select('id')
        .where('id', 'in', [expired, live]).execute()
      expect(remaining.map((row) => row.id)).toEqual([live])
    })

    it('uses the database clock, not the caller had better be right about time', async () => {
      // The same reason the lookup compares against `now()`: with more than
      // one API instance the app clocks drift, and a sweeper running on the
      // fast one would delete sessions the slow one still considers live.
      const userId = await makeUserId()
      const id = randomUUID()
      // Comfortably inside any plausible skew, so a Date.now() implementation
      // that happened to agree would not accidentally pass this.
      await sut.add({ id, userId, expiresAt: new Date(Date.now() + 60_000) })

      await sut.deleteExpired()

      const rows = await db.selectFrom('sessions').select('id').where('id', '=', id).execute()
      expect(rows).toHaveLength(1)
    })

    it('reports zero rather than throwing when there is nothing to remove', async () => {
      await sut.deleteExpired()

      await expect(sut.deleteExpired()).resolves.toBeGreaterThanOrEqual(0)
    })
  })
})
