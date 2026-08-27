import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table violations alter column impact drop not null`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`delete from violations where impact is null`.execute(db);
  await sql`alter table violations alter column impact set not null`.execute(db);
};
