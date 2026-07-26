import type { Migration, MigrationProvider } from 'kysely/migration'
import * as initialSchema from './001-initial-schema.js'

/**
 * Migrations are registered here rather than discovered from disk.
 *
 * Kysely's FileMigrationProvider resolves .js files relative to __dirname,
 * which under "type": "module" + NodeNext means three different paths — one
 * under tsx, one under dist/, one under Vitest. A typechecked object literal
 * removes the problem and cannot drift from what actually compiled.
 */
export const migrations: Record<string, Migration> = {
  '001-initial-schema': initialSchema
}

export const staticMigrationProvider: MigrationProvider = {
  async getMigrations (): Promise<Record<string, Migration>> {
    return migrations
  }
}
