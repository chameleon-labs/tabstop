import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  // The account's daily allowance, recorded AS ITS OWN FACT rather than
  // counted over the audits it produced (#115).
  //
  // The obvious implementation - a flag on `audits`, counted through the pages
  // an account holds - is refundable by deleting a page. Deleting a page
  // cascades its audits, so the count drops and the same day's allowance can be
  // spent again on another page. An entitlement has to outlive the thing it
  // paid for, which means a row of its own that page deletion does not touch.
  //
  // `audit_id` says which audit the spend produced, and is nullable for exactly
  // that reason: when the audit goes, the spend stays.
  await db.schema
    .createTable('on_demand_audits')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('user_id', 'bigint', (col) => col.notNull().references('users.id').onDelete('cascade'))
    // A stored date, like `audits.scheduled_for` and for the same reason:
    // `timestamptz::date` is STABLE rather than IMMUTABLE, so deriving the day
    // from `created_at` cannot be indexed, and the day the allowance belongs to
    // is a property of the decision rather than of the insert.
    .addColumn('spent_on', 'date', (col) => col.notNull())
    .addColumn('audit_id', 'bigint', (col) => col.references('audits.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // The allowance check's only query, and it runs on every request.
  await db.schema
    .createIndex('on_demand_audits_user_day_idx')
    .on('on_demand_audits')
    .columns(['user_id', 'spent_on'])
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('on_demand_audits').ifExists().execute();
};
