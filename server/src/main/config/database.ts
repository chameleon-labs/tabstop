import type { Kysely } from 'kysely'
import type { Database } from '../../infra/db/postgres/database.js'
import { makeDatabase } from '../../infra/db/postgres/helpers/postgres-helper.js'

let database: Kysely<Database> | null = null

export const connectDatabase = (connectionString: string): Kysely<Database> => {
  if (database !== null) {
    // Overwriting would strand the previous pool: nothing else holds a
    // reference, so it would stay open until the process exits. Reconnecting
    // is always a wiring mistake, so fail loudly rather than leak quietly.
    throw new Error('Database is already connected. Call disconnectDatabase() before reconnecting.')
  }

  database = makeDatabase(connectionString)
  return database
}

export const getDatabase = (): Kysely<Database> => {
  if (database === null) {
    throw new Error('Database is not connected. Call connectDatabase() first.')
  }
  return database
}

export const disconnectDatabase = async (): Promise<void> => {
  if (database !== null) {
    await database.destroy()
    database = null
  }
}
