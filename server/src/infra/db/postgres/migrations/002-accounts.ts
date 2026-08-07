import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('users')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    // Lowercased by the repository before every write and lookup, rather than
    // stored as citext: no extension, and the unique constraint below doubles
    // as the lookup index.
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('password_digest', 'text', (col) => col.notNull())
    // Score points. Read by regression detection (#14). 0 would alert on every
    // audit that failed to improve; above 100 could never fire.
    .addColumn('alert_threshold', 'smallint', (col) => col.notNull().defaultTo(5))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Named explicitly rather than left to the .unique() column modifier, which
    // yields Postgres's auto-generated `users_email_key`. The signup repository
    // matches on this name to turn a lost race into a 409, so it must not be
    // a name the database happened to pick.
    .addUniqueConstraint('users_email_unique', ['email'])
    .addCheckConstraint('users_alert_threshold_check', sql`alert_threshold between 1 and 100`)
    .execute();

  await db.schema
    .createTable('sessions')
    // text, not uuid: the value is 32 random bytes as hex, a format we own.
    // It also avoids the SQLSTATE 22P02 trap that audits.public_uuid needed a
    // guard for - a malformed value here is simply a miss.
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('user_id', 'bigint', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .execute();

  // Covers the FK. #4 measured a 40x difference on cascade deletes without one.
  await sql`create index sessions_user_idx on sessions (user_id)`.execute(db);

  // The debt #4 deferred: sites.user_id was created nullable with no FK
  // because this table did not exist yet. No production data, so no backfill.
  await sql`
    alter table sites
      add constraint sites_user_id_fkey
        foreign key (user_id) references users(id) on delete cascade
  `.execute(db);

  await sql`alter table sites alter column user_id set not null`.execute(db);

  // Impossible while user_id was nullable: NULLs never collide in a unique
  // index, so the constraint would have failed open - the same trap that made
  // the #4 alert dedupe silently permit duplicates.
  await sql`
    alter table sites
      add constraint sites_user_domain_unique unique (user_id, domain)
  `.execute(db);

  // No separate index on sites(user_id): the unique constraint above already
  // creates a btree with user_id leading, which serves FK cascade lookups and
  // `where user_id = ?` alike. A second one would be maintained on every write
  // for no query it uniquely answers.
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table sites drop constraint if exists sites_user_domain_unique`.execute(db);
  await sql`alter table sites alter column user_id drop not null`.execute(db);
  await sql`alter table sites drop constraint if exists sites_user_id_fkey`.execute(db);
  await db.schema.dropTable('sessions').execute();
  await db.schema.dropTable('users').execute();
};
