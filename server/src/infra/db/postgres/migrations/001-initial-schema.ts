import {sql, type Kysely} from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('sites')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('user_id', 'bigint')
    .addColumn('domain', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable('pages')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('site_id', 'bigint', (col) => col.notNull().references('sites.id').onDelete('cascade'))
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('monitoring_enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('pages_site_id_url_unique', ['site_id', 'url'])
    .execute();

  await db.schema
    .createTable('audits')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('public_uuid', 'uuid', (col) => col.notNull().defaultTo(sql`gen_random_uuid()`))
    .addColumn('page_id', 'bigint', (col) => col.references('pages.id').onDelete('cascade'))
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('score', 'smallint')
    .addColumn('counts_by_impact', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{"minor":0,"moderate":0,"serious":0,"critical":0}'::jsonb`),
    )
    .addColumn('axe_version', 'text')
    .addColumn('duration_ms', 'integer')
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .addCheckConstraint('audits_status_check', sql`status in ('queued','running','done','failed')`)
    .addCheckConstraint('audits_score_range_check', sql`score between 0 and 100`)
    .addCheckConstraint(
      'audits_counts_complete_check',
      sql`counts_by_impact ?& array['minor','moderate','serious','critical']`,
    )
    .execute();

  await db.schema
    .createTable('violations')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('audit_id', 'bigint', (col) => col.notNull().references('audits.id').onDelete('cascade'))
    .addColumn('rule_id', 'text', (col) => col.notNull())
    .addColumn('impact', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addColumn('help_url', 'text', (col) => col.notNull())
    .addColumn('nodes', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addCheckConstraint('violations_impact_check', sql`impact in ('minor','moderate','serious','critical')`)
    .execute();

  await db.schema
    .createTable('alert_events')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('page_id', 'bigint', (col) => col.notNull().references('pages.id').onDelete('cascade'))
    .addColumn('audit_id', 'bigint', (col) => col.notNull().references('audits.id').onDelete('cascade'))
    .addColumn('previous_audit_id', 'bigint', (col) => col.references('audits.id').onDelete('set null'))
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('emailed_at', 'timestamptz')
    .addCheckConstraint('alert_events_kind_check', sql`kind in ('score_drop','new_critical')`)
    .execute();

  await sql`create unique index audits_public_uuid_idx on audits (public_uuid)`.execute(db);

  await sql`
    create index audits_page_created_idx on audits (page_id, created_at desc)
      where page_id is not null
  `.execute(db);

  await sql`create index violations_audit_idx on violations (audit_id)`.execute(db);

  await sql`
    create unique index alert_events_one_per_page_per_day
      on alert_events (page_id, ((created_at at time zone 'UTC')::date))
  `.execute(db);

  await sql`create index alert_events_audit_idx on alert_events (audit_id)`.execute(db);
  await sql`create index alert_events_previous_audit_idx on alert_events (previous_audit_id)`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('alert_events').execute();
  await db.schema.dropTable('violations').execute();
  await db.schema.dropTable('audits').execute();
  await db.schema.dropTable('pages').execute();
  await db.schema.dropTable('sites').execute();
};
