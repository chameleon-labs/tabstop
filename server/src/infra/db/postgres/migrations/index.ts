import type { Migration, MigrationProvider } from 'kysely/migration'

/**
 * Migrations are registered here rather than discovered from disk.
 *
 * Kysely's FileMigrationProvider resolves .js files relative to __dirname,
 * which under "type": "module" + NodeNext means three different paths — one
 * under tsx, one under dist/, one under Vitest. A typechecked object literal
 * removes the problem and cannot drift from what actually compiled.
 *
 * Empty until #4 introduces the first real migration.
 */
export const migrations: Record<string, Migration> = {}

export const staticMigrationProvider: MigrationProvider = {
  async getMigrations (): Promise<Record<string, Migration>> {
    return migrations
  }
}
