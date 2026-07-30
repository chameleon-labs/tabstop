import { CompiledQuery, Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import type { Database } from '../database.js'

/**
 * Tools for asserting on how a query RUNS, not only on what it returns.
 *
 * Two things here have already caught real defects. Row counts caught a
 * history query whose output was bounded while its scan was not - the plan
 * looked right and the results were right, and it read every audit a page had
 * ever had. Plan text catches the other direction: an index that stops being
 * used because a predicate changed shape, which nothing else notices until the
 * table is large enough to hurt.
 *
 * Both read the query the repository ACTUALLY issued, captured off Kysely's
 * log hook, rather than a copy pasted into a spec - a copy silently stops
 * testing anything the moment the real query changes.
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

/** The first recorded query whose SQL matches, so a spec can name what it means. */
export const queryMatching = (
  issued: IssuedQuery[], pattern: RegExp
): IssuedQuery | undefined => issued.find((query) => pattern.test(query.sql))

/**
 * Rows read from one relation, across every node of an
 * `EXPLAIN (ANALYZE, FORMAT JSON)` plan that scans it.
 *
 * Narrowed as it walks rather than typed: the plan tree is the planner's to
 * change, and a type describing it would be a claim this cannot check.
 *
 * `Actual Rows` is reported PER LOOP, so an inner scan of a nested loop has to
 * be multiplied by its loop count - which is the whole point, since a lateral
 * runs one bounded scan per outer row and the total is what matters.
 *
 * Summing every node's rows instead was the first attempt and is meaningless:
 * it multiplies the answer by the depth of the plan, so a Sort over a Nested
 * Loop over a Limit counts the same thirty rows four times.
 */
const rowsReadFrom = (relation: string, node: unknown): number => {
  if (Array.isArray(node)) {
    return node.reduce<number>((total, child) => total + rowsReadFrom(relation, child), 0)
  }
  if (typeof node !== 'object' || node === null) return 0

  const fields: Record<string, unknown> = { ...node }
  const scanned = fields['Relation Name'] === relation
  const rows = typeof fields['Actual Rows'] === 'number' ? fields['Actual Rows'] : 0
  const loops = typeof fields['Actual Loops'] === 'number' ? fields['Actual Loops'] : 1
  const here = scanned ? rows * loops : 0

  return here + Object.entries(fields)
    .filter(([key]) => key === 'Plans' || key === 'Plan')
    .reduce<number>((total, [, value]) => total + rowsReadFrom(relation, value), 0)
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
 * Text rather than JSON because that is what the assertion reads like - a spec
 * saying `toContain('audits_page_created_idx')` needs no explanation. Note
 * that a plan assertion is only meaningful with enough rows for the planner to
 * prefer an index: on a handful it will sequentially scan, correctly, and a
 * spec that did not seed data would be asserting the opposite of what it means.
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
