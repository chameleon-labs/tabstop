import { Migrator, type MigrationResult } from 'kysely/migration'
import type { Kysely } from 'kysely'
import type { Database } from '../database.js'
import { staticMigrationProvider } from './index.js'

const makeMigrator = (db: Kysely<Database>): Migrator =>
  new Migrator({ db, provider: staticMigrationProvider })

const unwrap = (error: unknown, results: MigrationResult[] | undefined): readonly MigrationResult[] => {
  if (error !== undefined) {
    throw error instanceof Error ? error : new Error(String(error))
  }
  return results ?? []
}

export const runMigrations = async (db: Kysely<Database>): Promise<readonly MigrationResult[]> => {
  const { error, results } = await makeMigrator(db).migrateToLatest()
  return unwrap(error, results)
}
