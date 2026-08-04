import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from '../database.js'

export interface DatabaseOptions {
  /**
   * Server-side `statement_timeout`, in milliseconds. Postgres cancels a
   * statement that outruns it and the driver surfaces `57014`, which is the
   * only bound this codebase has on a query once it has started: the per-job
   * `runWithTimeout` aborts an `AbortSignal` nothing downstream receives, so
   * it ends the attempt while the statement keeps its connection (#52).
   *
   * Omitted means unbounded, and that is deliberate rather than a default:
   * migrations build indexes that legitimately outrun any sane timeout, and
   * being cancelled halfway is the one failure they must not have. Callers
   * that serve requests or run jobs should always pass it.
   */
  statementTimeoutMs?: number
}

export const makeDatabase = (
  connectionString: string,
  options: DatabaseOptions = {}
): Kysely<Database> => {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    // Sent as a startup parameter, so every connection the pool opens carries
    // it - not just the first one to run a query.
    ...(options.statementTimeoutMs !== undefined && { statement_timeout: options.statementTimeoutMs })
  })

  // An idle client whose backend goes away emits 'error' outside any query
  // path. Without this listener Node treats it as an unhandled error event
  // and kills the process, which would defeat the degraded-not-dead design.
  pool.on('error', (error) => {
    console.error('Postgres pool error (connection dropped):', error.message)
  })

  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) })
}
