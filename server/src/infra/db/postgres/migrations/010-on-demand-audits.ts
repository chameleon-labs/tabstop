import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('on_demand_audits')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('user_id', 'bigint', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('spent_on', 'date', (col) => col.notNull())
    .addColumn('audit_id', 'bigint', (col) => col.references('audits.id').onDelete('set null'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('on_demand_audits_user_day_idx')
    .on('on_demand_audits')
    .columns(['user_id', 'spent_on'])
    .execute();
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('on_demand_audits').ifExists().execute();
};
