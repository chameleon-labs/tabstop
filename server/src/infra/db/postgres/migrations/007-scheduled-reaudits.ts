import { sql, type Kysely } from 'kysely'

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // Which day's scheduled run produced this audit. Null for every other audit:
  // the first one an added page gets, a one-off anonymous submission, and any
  // manual re-audit a later issue adds.
  //
  // A date rather than a derived expression, because #13's sketch proposed
  // deriving the day from `created_at` and that is wrong twice over. It cannot
  // be indexed at all - `timestamptz::date` is STABLE, not IMMUTABLE, the same
  // wall #4 hit on alert_events - and pinning the zone to fix that still leaves
  // a constraint that counts audits nobody scheduled, so a manual re-audit
  // would be refused because the nightly run already happened. Recording the
  // intent instead keeps the rule about scheduled work only.
  //
  // It also makes the day a property of the RUN rather than of the insert: a
  // fan-out that starts at 23:59:59 stamps every row with one date, where
  // `created_at::date` would split it across two and let both halves insert.
  await sql`alter table audits add column scheduled_for date`.execute(db)

  // The authoritative half of "exactly one audit per enabled page per day".
  // The eligibility query already excludes pages with work in flight, but that
  // is check-then-act: two runs overlapping - a retry, two replicas, a
  // scheduler misfire - both select the same page before either inserts. This
  // is what makes the promise true regardless.
  //
  // Partial, so it holds only scheduled rows. NULLs never collide in a unique
  // index, which is the trap #4 documented on alert_events; here that is
  // exactly the wanted behaviour, and it is confined to a column nothing but
  // the scheduler writes.
  await sql`
    create unique index audits_one_scheduled_per_page_per_day
      on audits (page_id, scheduled_for) where scheduled_for is not null
  `.execute(db)

  // The eligibility query's other half: skip a page that already has a queued
  // or running audit, and only if that audit is recent enough to still be
  // real. Without an index the check reads every audit the page has ever had,
  // to find none - a cost that grows for as long as the account is a customer,
  // paid once per page per night.
  //
  // Partial on the two live statuses, so it holds a handful of rows rather
  // than the whole table, and a finished audit drops out of it. `created_at`
  // is in the index rather than left to a filter because the query bounds it:
  // an unfinished audit older than the grace window is one nothing is going to
  // finish, and it must stop hiding its page.
  await sql`
    create index audits_in_flight_page_idx on audits (page_id, created_at)
      where status in ('queued','running')
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index if exists audits_in_flight_page_idx`.execute(db)
  await sql`drop index if exists audits_one_scheduled_per_page_per_day`.execute(db)
  await sql`alter table audits drop column scheduled_for`.execute(db)
}
