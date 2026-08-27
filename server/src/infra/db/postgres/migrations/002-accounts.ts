import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('users')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('password_digest', 'text', (col) => col.notNull())
    .addColumn('alert_threshold', 'smallint', (col) => col.notNull().defaultTo(5))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('users_email_unique', ['email'])
    .addCheckConstraint('users_alert_threshold_check', sql`alert_threshold between 1 and 100`)
    .execute();

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'bigint', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute();

  await sql`create index sessions_user_idx on sessions (user_id)`.execute(db);

  await sql`
    alter table sites
      add constraint sites_user_id_fkey
        foreign key (user_id) references users(id) on delete cascade
  `.execute(db);

  await sql`alter table sites alter column user_id set not null`.execute(db);

  await sql`
    alter table sites
      add constraint sites_user_domain_unique unique (user_id, domain)
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table sites drop constraint if exists sites_user_domain_unique`.execute(db);
  await sql`alter table sites alter column user_id drop not null`.execute(db);
  await sql`alter table sites drop constraint if exists sites_user_id_fkey`.execute(db);
  await db.schema.dropTable('sessions').execute();
  await db.schema.dropTable('users').execute();
};
