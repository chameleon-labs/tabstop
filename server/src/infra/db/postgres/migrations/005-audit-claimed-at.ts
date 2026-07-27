import { sql, type Kysely } from 'kysely'

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // When the current attempt took the audit. Claiming needs it because
  // `status` alone cannot distinguish "another worker is running this right
  // now" from "a worker died mid-audit and left it here" - and the two need
  // opposite answers: exclude the first, allow the second.
  await sql`alter table audits add column claimed_at timestamptz`.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table audits drop column claimed_at`.execute(db)
}
