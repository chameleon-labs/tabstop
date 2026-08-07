import { CompiledQuery, Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from '../database.js'

/**
 * Tools for asserting on how a query RUNS, not only on what it returns.
 *
 * Both have caught real defects: row counts found a history query whose output
 * was bounded while its scan was not, and plan text catches an index the
 * planner quietly stops choosing because a predicate changed shape.
 *
 * Both read the query the repository ACTUALLY issued, captured off Kysely's
 * log hook - a copy pasted into a spec stops testing anything the moment the
 * real query changes.
 */
export type IssuedQuery = { sql: string, parameters: readonly unknown[] }

const connectionUrl = (): string => {
  const url = process.env.DATABASE_URL
  if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
  return url
}

/**
 * A connection that records every query it issues.
 *
 * `makeDatabase` deliberately exposes no logging hook - it is the production
 * factory, and a log option there would be a knob nothing turns - so the
 * instrumented instance is built here, where the only callers are specs.
 */
export const makeRecordingDatabase = (sink: IssuedQuery[]): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: connectionUrl() }) }),
    log: (event) => {
      if (event.level === 'query') {
        sink.push({ sql: event.query.sql, parameters: event.query.parameters })
      }
    }
  })

/**
 * The first recorded query whose SQL matches, so a spec can name what it means.
 *
 * EXPLAIN runs are skipped: the helpers below issue theirs through the same
 * recording connection, so looking one up again asks the database to explain
 * an explain.
 *
 * Prefer counting across every recorded query where a spec can - a search
 * pattern couples the assertion to the query's SHAPE, so a rewrite makes the
 * lookup fail rather than the measurement disagree, and a guard that fails
 * first is not a measurement.
 */
export const queryMatching = (
  issued: IssuedQuery[], pattern: RegExp
): IssuedQuery | undefined => issued.find(
  (query) => !/^\s*explain\b/i.test(query.sql) && pattern.test(query.sql)
)

/**
 * Rows read from one relation, across every node of an
 * `EXPLAIN (ANALYZE, FORMAT JSON)` plan that scans it.
 *
 * Narrowed as it walks rather than typed: the plan tree is the planner's to
 * change, and a type describing it would be a claim this cannot check.
 *
 * Rows READ, not rows returned - a node's discarded rows count too, which is
 * the whole measurement for an `exists` check that returns nothing whether it
 * examined one row or a million.
 *
 * Three constraints, each from a version that was wrong. Attribute rows only
 * where a node NAMES the relation, or a Sort over a Nested Loop over a Limit
 * counts the same thirty rows four times. Descend through every value, not
 * just `Plan`/`Plans`: the document is `[{ "QUERY PLAN": [...] }]`, so a
 * narrower walk stops at the first key and returns 0 for everything. And count
 * `Rows Removed by Filter` as well as `Actual Rows`, or a scan of a page's
 * whole history that emits nothing measures as zero.
 *
 * The 0-for-everything version survived a mutation check, which is worth
 * knowing: the mutation changed the query's shape too, so the "did we find the
 * query" guard went red first. A count assertion has to be mutation-checked
 * against a change that leaves the query FINDABLE.
 */
const numberAt = (fields: Record<string, unknown>, key: string, fallback = 0): number =>
  typeof fields[key] === 'number' ? fields[key] : fallback

const rowsReadFrom = (relation: string, node: unknown): number => {
  if (Array.isArray(node)) {
    return node.reduce<number>((total, child) => total + rowsReadFrom(relation, child), 0)
  }
  if (typeof node !== 'object' || node === null) return 0

  const fields: Record<string, unknown> = { ...node }
  // Only scan nodes carry `Relation Name`, so descending everywhere cannot
  // double-count - a Sort above an Index Scan contributes nothing of its own.
  const scanned = fields['Relation Name'] === relation
  const rows = numberAt(fields, 'Actual Rows')
  // Rows the node touched and threw away. Without these the count measures
  // OUTPUT rather than work, and the two differ by exactly the amount that
  // matters: an `exists` check answered by scanning a page's whole audit
  // history and filtering on status emits zero rows and reads all of them, so
  // a count that stopped at `Actual Rows` would report 0 for the plan it is
  // meant to catch. Both discard counters are included because which one
  // Postgres uses depends on the scan it picked, not on the query.
  const discarded = numberAt(fields, 'Rows Removed by Filter') +
    numberAt(fields, 'Rows Removed by Index Recheck')
  // `Actual Rows` is per loop, so an inner scan has to be multiplied by its
  // loop count - which is the point, since a lateral or an anti-join runs one
  // bounded scan per outer row and the total is what costs.
  const loops = numberAt(fields, 'Actual Loops', 1)
  const here = scanned ? (rows + discarded) * loops : 0

  return here + Object.values(fields)
    .reduce<number>((total, value) => total + rowsReadFrom(relation, value), 0)
}

export const explainRowsRead = async (
  db: Kysely<Database>, query: IssuedQuery, relation: string
): Promise<number> => {
  const explained = await db.executeQuery(CompiledQuery.raw(
    `explain (analyze, format json) ${query.sql}`, [...query.parameters]
  ))

  if (explained.rows.length === 0) throw new Error('EXPLAIN returned no plan')
  // Fed the whole result rather than reached into by key: the walk narrows as
  // it goes, so it does not need a type for the planner's document.
  return rowsReadFrom(relation, explained.rows)
}

/**
 * The plan as text, for asserting that a particular index is the one chosen.
 *
 * Text because `toContain('audits_page_created_idx')` needs no explanation.
 * Only meaningful with enough rows for the planner to prefer an index: on a
 * handful it correctly scans sequentially, so an unseeded spec asserts the
 * opposite of what it means.
 */
export const explainPlanText = async (
  db: Kysely<Database>, query: IssuedQuery
): Promise<string> => {
  const explained = await db.executeQuery(CompiledQuery.raw(
    `explain (analyze) ${query.sql}`, [...query.parameters]
  ))

  // One column, `QUERY PLAN`, one row per plan line. Read by narrowing rather
  // than by name, so a driver that types the row as `{}` does not need a cast.
  return explained.rows
    .flatMap((row) => (typeof row === 'object' && row !== null ? Object.values(row) : []))
    .filter((value) => typeof value === 'string')
    .join('\n')
}
