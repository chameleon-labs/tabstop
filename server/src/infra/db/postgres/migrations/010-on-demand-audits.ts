import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // Whether a person asked for this audit, as opposed to the nightly run or
  // the insert that adding a page performs.
  //
  // A column rather than a derivation, because nothing already on the row can
  // answer it. `scheduled_for` separates the nightly run from everything else,
  // but a page's first audit and an on-demand one are both null there - and
  // counting the two together would refuse somebody's on-demand audit because
  // they added a page that morning.
  //
  // Not null with a default of false, which is exact rather than a guess:
  // every row that predates this migration was created when there was no way
  // to ask for one.
  await sql`alter table audits add column on_demand boolean not null default false`.execute(db);

  // The allowance is one per ACCOUNT per UTC day, so the count is taken across
  // the pages an account holds - up to ten - and this serves it directly.
  //
  // Partial, so it holds only the rows the allowance is about. On-demand
  // audits are the rarest kind by construction, so this index stays small
  // enough to be worth having next to a check that runs on every request.
  await sql`
    create index audits_on_demand_idx on audits (page_id, created_at) where on_demand
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop index if exists audits_on_demand_idx`.execute(db);
  await sql`alter table audits drop column on_demand`.execute(db);
};
