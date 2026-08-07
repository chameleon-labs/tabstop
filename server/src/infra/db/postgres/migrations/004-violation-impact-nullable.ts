import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // axe reports `impact: null` for a violation whose failing checks carry no
  // severity. Dropping those rows would mark an audit `done` while silently
  // omitting real findings, so they are stored with a null impact instead and
  // simply left out of the impact counts.
  //
  // The existing check constraint needs no change: a CHECK whose expression
  // evaluates to NULL passes, so `impact in (...)` already admits null once
  // the column allows it.
  await sql`alter table violations alter column impact drop not null`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`delete from violations where impact is null`.execute(db);
  await sql`alter table violations alter column impact set not null`.execute(db);
};
