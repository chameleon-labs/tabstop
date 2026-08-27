import type {Kysely} from 'kysely';
import type {Database} from '../../infra/db/postgres/database.js';
import {makeDatabase} from '../../infra/db/postgres/helpers/postgres-helper.js';
import {env} from './env.js';

let database: Kysely<Database> | null = null;

export const connectDatabase = (
  connectionString: string,
  statementTimeoutMs: number = env.databaseStatementTimeoutMs,
): Kysely<Database> => {
  if (database !== null) {
    throw new Error('Database is already connected. Call disconnectDatabase() before reconnecting.');
  }

  database = makeDatabase(connectionString, {statementTimeoutMs});
  return database;
};

export const getDatabase = (): Kysely<Database> => {
  if (database === null) {
    throw new Error('Database is not connected. Call connectDatabase() first.');
  }
  return database;
};

export const disconnectDatabase = async (): Promise<void> => {
  if (database !== null) {
    await database.destroy();
    database = null;
  }
};
