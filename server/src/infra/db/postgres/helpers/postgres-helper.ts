import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from '../database.js'

export const makeDatabase = (connectionString: string): Kysely<Database> => {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 })

  // An idle client whose backend goes away emits 'error' outside any query
  // path. Without this listener Node treats it as an unhandled error event
  // and kills the process, which would defeat the degraded-not-dead design.
  pool.on('error', (error) => {
    console.error('Postgres pool error (connection dropped):', error.message)
  })

  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}
