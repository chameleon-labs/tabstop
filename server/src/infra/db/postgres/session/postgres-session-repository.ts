import { sql, type Kysely } from 'kysely'
import type { SessionModel } from '../../../../domain/models/session.js'
import type {
  AddSessionRepository,
  AddSessionRepositoryParams
} from '../../../../data/protocols/db/session/add-session-repository.js'
import type {
  DeleteSessionRepository
} from '../../../../data/protocols/db/session/delete-session-repository.js'
import type {
  DeleteExpiredSessionsRepository
} from '../../../../data/protocols/db/session/delete-expired-sessions-repository.js'
import type { Database } from '../database.js'
import { toSessionModel } from './session-mapper.js'

export class PostgresSessionRepository
implements AddSessionRepository, DeleteSessionRepository, DeleteExpiredSessionsRepository {
  constructor (private readonly db: Kysely<Database>) {}

  async add (params: AddSessionRepositoryParams): Promise<SessionModel> {
    const row = await this.db
      .insertInto('sessions')
      .values({ id: params.id, user_id: params.userId, expires_at: params.expiresAt })
      .returningAll()
      .executeTakeFirstOrThrow()

    return toSessionModel(row)
  }

  async deleteById (sessionId: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('id', '=', sessionId).execute()
  }

  async deleteExpired (): Promise<number> {
    // `now()` from the database, not a Date from this process - the same
    // reason loadBySessionId compares against it. With more than one API
    // instance the app clocks drift, and a sweeper running on the fast one
    // would delete sessions the slow one still considers live.
    const result = await this.db
      .deleteFrom('sessions')
      .where('expires_at', '<=', sql<Date>`now()`)
      .executeTakeFirst()

    return Number(result.numDeletedRows)
  }
}
