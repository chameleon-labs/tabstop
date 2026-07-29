import { sql, type Kysely } from 'kysely'

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // The sweeper's only predicate. Without it, deleting expired sessions is a
  // sequential scan of the whole table on every pass - which is worst exactly
  // when the table has grown enough to need sweeping.
  //
  // It serves no read: `loadBySessionId` looks a session up by primary key and
  // checks expiry on the row it already found. This index exists for the
  // delete, and for a future "sessions expiring soon" query if one appears.
  await sql`create index sessions_expires_at_idx on sessions (expires_at)`.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index if exists sessions_expires_at_idx`.execute(db)
}
