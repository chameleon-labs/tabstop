import { sql, type Kysely } from 'kysely'

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // Pausing email is not pausing monitoring. A user who asks to stop
  // notifications still keeps the history and daily checks they signed up
  // for; monitoring_enabled remains the scheduler's switch.
  await sql`
    alter table pages
      add column alerts_enabled boolean not null default true
  `.execute(db)

  // The dispatcher reads only work the provider has not confirmed. Partial,
  // so delivered history does not make that scan grow forever.
  await sql`
    create index alert_events_unsent_idx
      on alert_events (id) where emailed_at is null
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index if exists alert_events_unsent_idx`.execute(db)
  await sql`alter table pages drop column alerts_enabled`.execute(db)
}
