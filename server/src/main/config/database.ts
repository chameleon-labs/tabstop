import type { Kysely } from 'kysely'
import type { Database } from '../../infra/db/postgres/database.js'
import { makeDatabase } from '../../infra/db/postgres/helpers/postgres-helper.js'

let database: Kysely<Database> | null = null

export const connectDatabase = (connectionString: string): Kysely<Database> => {
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
