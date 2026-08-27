import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`create index sessions_expires_at_idx on sessions (expires_at)`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index if exists sessions_expires_at_idx`.execute(db);
};
