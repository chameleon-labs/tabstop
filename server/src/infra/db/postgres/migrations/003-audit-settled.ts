import { sql, type Kysely } from 'kysely'

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // True when the page reached network idle; false when it never stopped
  // requesting and was audited anyway. Without this, a score from a possibly
  // half-rendered page is indistinguishable from a genuinely clean one - the
  // worst failure this worker can have, because it looks like success.
  //
  // Defaulting to true is safe for the rows 001 created: they are all queued
  // and have never run.
  await sql`alter table audits add column settled boolean not null default true`.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table audits drop column settled`.execute(db)
}
