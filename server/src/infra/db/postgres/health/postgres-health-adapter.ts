import { sql, type Kysely } from 'kysely'
import type { DatabaseHealthProvider } from '../../../../data/protocols/db/database-health-provider.js'
import type { Database } from '../database.js'

export class PostgresHealthAdapter implements DatabaseHealthProvider {
  constructor (private readonly db: Kysely<Database>) {}

  async isReachable (): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db)
      return true
    } catch (error) {
      // Deliberately reports rather than throws: the caller degrades the
      // service (503) instead of crashing it, but the diagnosis still needs
      // to land somewhere so an operator can see why.
      console.error('Postgres health check failed:', error)
      return false
    }
  }
}
