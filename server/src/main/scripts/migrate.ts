import { env } from '../config/env.js'
import { makeDatabase } from '../../infra/db/postgres/helpers/postgres-helper.js'
import { runMigrations } from '../../infra/db/postgres/migrations/migrator.js'

// Deliberately `makeDatabase` and not `connectDatabase`: this is the caller
// that must run with no statement_timeout. Migrations build indexes, which on
// a large `audits` table legitimately outruns any bound worth setting for
// request and job traffic, and a migration killed halfway is a far worse
// failure than a slow one. See #52.
const db = makeDatabase(env.databaseUrl)

try {
  const results = await runMigrations(db)

  if (results.length === 0) {
    console.log('No pending migrations.')
  }
  for (const result of results) {
    console.log(`${result.status}: ${result.migrationName}`)
  }
} catch (error) {
  console.error('Migration failed:', error)
  process.exitCode = 1
} finally {
  await db.destroy()
}
