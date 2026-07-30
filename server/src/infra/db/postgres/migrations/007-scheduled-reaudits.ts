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

  // Serves both halves of the nightly run, which ask different questions of
  // the same small set of rows - but they ask DIFFERENT questions, and one
  // index cannot answer both.
  //
  // The eligibility query asks whether a given page has any unfinished audit:
  // `page_id = ?`, with no bound on age, because ageing them out compounds
  // under load - on a queue that has not drained, real pending audits look
  // abandoned and their pages get scheduled again on top of the backlog.
  // Without an index that check reads every audit the page has ever had, to
  // find none: a cost that grows for as long as the account is a customer,
  // paid once per page per night.
  await sql`
    create index audits_in_flight_page_idx on audits (page_id)
      where status in ('queued','running')
  `.execute(db)

  // The reclaim pass asks a global question - which unfinished audits are old
  // enough to be worth checking against the queue - and wants them oldest
  // first, bounded by a limit.
  //
  // That needs `created_at` LEADING. It was originally a trailing column on
  // the index above, which reads plausibly and does not work: with `page_id`
  // unconstrained, Postgres cannot walk that index in `created_at` order, so
  // it reads the whole live set and sorts before applying the limit. Fine
  // while the live set is small - and useless exactly when it is not, which
  // is when a stale backlog has built up and this pass is the thing meant to
  // clear it.
  //
  // Both are partial on the two live statuses, so each holds a handful of
  // rows rather than the whole table and a finished audit drops out of both.
  // That is what makes a second index cheap enough to be worth having rather
  // than a compromise between two access patterns that serves neither.
  await sql`
    create index audits_in_flight_created_idx on audits (created_at)
      where status in ('queued','running')
  `.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index if exists audits_in_flight_created_idx`.execute(db)
  await sql`drop index if exists audits_in_flight_page_idx`.execute(db)
  await sql`drop index if exists audits_one_scheduled_per_page_per_day`.execute(db)
  await sql`alter table audits drop column scheduled_for`.execute(db)
}
