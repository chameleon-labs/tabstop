import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table audits add column claimed_at timestamptz`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table audits drop column claimed_at`.execute(db);
};
