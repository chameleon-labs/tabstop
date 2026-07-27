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
})
