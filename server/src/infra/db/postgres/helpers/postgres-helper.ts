import {Kysely, PostgresDialect} from 'kysely';
import {Pool} from 'pg';
import type {Database} from '../database.js';

export interface DatabaseOptions {
  statementTimeoutMs?: number;
}

export const makeDatabase = (connectionString: string, options: DatabaseOptions = {}): Kysely<Database> => {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    ...(options.statementTimeoutMs !== undefined && {statement_timeout: options.statementTimeoutMs}),
  });

  pool.on('error', (error) => {
    console.error('Postgres pool error (connection dropped):', error.message);
  });

  return new Kysely<Database>({dialect: new PostgresDialect({pool})});
};
