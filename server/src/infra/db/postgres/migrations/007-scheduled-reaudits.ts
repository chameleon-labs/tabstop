import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // Which day's scheduled run produced this audit. Null for every other audit.
  //
  // A stored date rather than deriving the day from `created_at`, which is
  // wrong twice over: `timestamptz::date` is STABLE, not IMMUTABLE, so it
  // cannot be indexed (the wall #4 hit on alert_events), and pinning the zone
  // still leaves a constraint that counts audits nobody scheduled - refusing a
  // manual re-audit because the nightly run happened.
  //
  // It also makes the day a property of the RUN rather than the insert: a
  // fan-out starting at 23:59:59 stamps one date, whereas `created_at::date`
  // splits it across two and lets both halves insert.
  await sql`alter table audits add column scheduled_for date`.execute(db);

  // The authoritative half of "exactly one audit per enabled page per day".
  // The eligibility query is check-then-act, so two overlapping runs both
  // select a page before either inserts; this makes the promise true anyway.
  //
  // Partial, so it holds only scheduled rows. NULLs never collide in a unique
  // index - the trap #4 documented on alert_events - which is exactly the
  // wanted behaviour on a column only the scheduler writes.
  await sql`
    create unique index audits_one_scheduled_per_page_per_day
      on audits (page_id, scheduled_for) where scheduled_for is not null
  `.execute(db);

  // The nightly run's two halves ask different questions of the same small
  // set of rows, and one index cannot answer both.
  //
  // Eligibility asks whether a page has any unfinished audit: `page_id = ?`,
  // unbounded by age, because ageing them out compounds under load. Without an
  // index it reads every audit the page has ever had to find none - a cost
  // growing for as long as the account is a customer, paid nightly per page.
  await sql`
    create index audits_in_flight_page_idx on audits (page_id)
      where status in ('queued','running')
  `.execute(db);

  // The reclaim pass asks a global question - which unfinished audits are old
  // enough to check against the queue - oldest first, bounded by a limit.
  //
  // That needs `created_at` LEADING. As a trailing column on the index above
  // it reads plausibly and does not work: with `page_id` unconstrained,
  // Postgres cannot walk that index in `created_at` order, so it reads the
  // whole live set and sorts before applying the limit - useless exactly when
  // a stale backlog has built up and this pass is meant to clear it.
  //
  // `id` trails as the cursor's tiebreak: `created_at` is not unique, since
  // `now()` is transaction time and a fan-out's rows share one, and a cursor
  // that cannot tell two rows apart repeats one or steps over it.
  //
  // Both are partial on the two live statuses, so each holds a handful of rows
  // and a finished audit drops out of both - which is what makes a second
  // index cheaper than one compromise serving neither pattern.
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
