import { sql, type Kysely } from 'kysely'

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table alert_events
      add column previewed_at timestamptz,
      add column failed_at timestamptz,
      add column failure_reason varchar(200),
      add constraint alert_events_delivery_terminal_exclusive
        check (emailed_at is null or failed_at is null),
      add constraint alert_events_failure_reason_pair
        check ((failed_at is null) = (failure_reason is null));

    drop index alert_events_unsent_idx;
    create index alert_events_unsent_idx
      on alert_events (id)
      where emailed_at is null and failed_at is null;
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    drop index alert_events_unsent_idx;
    create index alert_events_unsent_idx
      on alert_events (id) where emailed_at is null;

    alter table alert_events
      drop constraint alert_events_delivery_terminal_exclusive,
      drop constraint alert_events_failure_reason_pair,
      drop column previewed_at,
      drop column failed_at,
      drop column failure_reason;
  `.execute(db)
}
