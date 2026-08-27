import {CompiledQuery, Kysely, PostgresDialect} from 'kysely';
import {Pool} from 'pg';
import type {Database} from '../database.js';

export type IssuedQuery = {sql: string; parameters: readonly unknown[]};

const connectionUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    throw new Error('DATABASE_URL not set by globalSetup');
  }
  return url;
};

export const makeRecordingDatabase = (sink: IssuedQuery[]): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new PostgresDialect({pool: new Pool({connectionString: connectionUrl()})}),
    log: (event) => {
      if (event.level === 'query') {
        sink.push({sql: event.query.sql, parameters: event.query.parameters});
      }
    },
  });

export const queryMatching = (issued: IssuedQuery[], pattern: RegExp): IssuedQuery | undefined =>
  issued.find((query) => !/^\s*explain\b/i.test(query.sql) && pattern.test(query.sql));

const numberAt = (fields: Record<string, unknown>, key: string, fallback = 0): number =>
  typeof fields[key] === 'number' ? fields[key] : fallback;

const rowsReadFrom = (relation: string, node: unknown): number => {
  if (Array.isArray(node)) {
    return node.reduce<number>((total, child) => total + rowsReadFrom(relation, child), 0);
  }
  if (typeof node !== 'object' || node === null) {
    return 0;
  }

  const fields: Record<string, unknown> = {...node};
  const scanned = fields['Relation Name'] === relation;
  const rows = numberAt(fields, 'Actual Rows');
  const discarded = numberAt(fields, 'Rows Removed by Filter') + numberAt(fields, 'Rows Removed by Index Recheck');
  const loops = numberAt(fields, 'Actual Loops', 1);
  const here = scanned ? (rows + discarded) * loops : 0;

  return here + Object.values(fields).reduce<number>((total, value) => total + rowsReadFrom(relation, value), 0);
};

export const explainRowsRead = async (db: Kysely<Database>, query: IssuedQuery, relation: string): Promise<number> => {
  const explained = await db.executeQuery(
    CompiledQuery.raw(`explain (analyze, format json) ${query.sql}`, [...query.parameters]),
  );

  if (explained.rows.length === 0) {
    throw new Error('EXPLAIN returned no plan');
  }
  return rowsReadFrom(relation, explained.rows);
};

export const explainPlanText = async (db: Kysely<Database>, query: IssuedQuery): Promise<string> => {
  const explained = await db.executeQuery(CompiledQuery.raw(`explain (analyze) ${query.sql}`, [...query.parameters]));

  return explained.rows
    .flatMap((row) => (typeof row === 'object' && row !== null ? Object.values(row) : []))
    .filter((value) => typeof value === 'string')
    .join('\n');
};
