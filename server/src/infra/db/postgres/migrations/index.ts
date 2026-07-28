import type { Migration, MigrationProvider } from 'kysely/migration'
import * as initialSchema from './001-initial-schema.js'
import * as accounts from './002-accounts.js'
import * as auditSettled from './003-audit-settled.js'
import * as violationImpactNullable from './004-violation-impact-nullable.js'
import * as auditClaimedAt from './005-audit-claimed-at.js'
import * as sessionsExpiresAtIndex from './006-sessions-expires-at-index.js'

/**
 * Migrations are registered here rather than discovered from disk.
 *
 * Kysely's FileMigrationProvider resolves .js files relative to __dirname,
 * which under "type": "module" + NodeNext means three different paths — one
 * under tsx, one under dist/, one under Vitest. A typechecked object literal
 * removes the problem and cannot drift from what actually compiled.
 */
export const migrations: Record<string, Migration> = {
  '001-initial-schema': initialSchema,
  '002-accounts': accounts,
  '003-audit-settled': auditSettled,
  '004-violation-impact-nullable': violationImpactNullable,
  '005-audit-claimed-at': auditClaimedAt,
  '006-sessions-expires-at-index': sessionsExpiresAtIndex
}

export const staticMigrationProvider: MigrationProvider = {
  async getMigrations (): Promise<Record<string, Migration>> {
    return migrations
  }
}
