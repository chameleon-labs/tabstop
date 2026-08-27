import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table audits add column scheduled_for date`.execute(db);

  await sql`
    create unique index audits_one_scheduled_per_page_per_day
      on audits (page_id, scheduled_for) where scheduled_for is not null
  `.execute(db);

  await sql`
    create index audits_in_flight_page_idx on audits (page_id)
      where status in ('queued','running')
  `.execute(db);

  await sql`
    create index audits_in_flight_created_idx on audits (created_at, id)
      where status in ('queued','running')
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index if exists audits_in_flight_created_idx`.execute(db);
  await sql`drop index if exists audits_in_flight_page_idx`.execute(db);
  await sql`drop index if exists audits_one_scheduled_per_page_per_day`.execute(db);
  await sql`alter table audits drop column scheduled_for`.execute(db);
};
