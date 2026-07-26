import { sql, type Kysely } from 'kysely'

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable('sites')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    // No FK and nullable until #10 creates the users table.
    .addColumn('user_id', 'bigint')
    .addColumn('domain', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema
    .createTable('pages')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('site_id', 'bigint', (col) =>
      col.notNull().references('sites.id').onDelete('cascade'))
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('monitoring_enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Without this, #13 audits a duplicated page twice: double cost, two emails.
    .addUniqueConstraint('pages_site_id_url_unique', ['site_id', 'url'])
    .execute()

  await db.schema
    .createTable('audits')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('public_uuid', 'uuid', (col) => col.notNull().defaultTo(sql`gen_random_uuid()`))
    // Null = anonymous one-off audit. Cascade so deleting a page kills its
    // history and the public share links pointing at it.
    .addColumn('page_id', 'bigint', (col) => col.references('pages.id').onDelete('cascade'))
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('score', 'smallint')
    .addColumn('counts_by_impact', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{"minor":0,"moderate":0,"serious":0,"critical":0}'::jsonb`))
    .addColumn('axe_version', 'text')
    .addColumn('duration_ms', 'integer')
    .addColumn('error', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('completed_at', 'timestamptz')
    .addCheckConstraint('audits_status_check', sql`status in ('queued','running','done','failed')`)
    .addCheckConstraint('audits_score_range_check', sql`score between 0 and 100`)
    // jsonb enforces no shape of its own, so the domain's Record<Impact, number>
    // would otherwise be a claim nothing checks.
    .addCheckConstraint(
      'audits_counts_complete_check',
      sql`counts_by_impact ?& array['minor','moderate','serious','critical']`
    )
    .execute()

  await db.schema
    .createTable('violations')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('audit_id', 'bigint', (col) =>
      col.notNull().references('audits.id').onDelete('cascade'))
    .addColumn('rule_id', 'text', (col) => col.notNull())
    .addColumn('impact', 'text', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addColumn('help_url', 'text', (col) => col.notNull())
    .addColumn('nodes', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addCheckConstraint(
      'violations_impact_check',
      sql`impact in ('minor','moderate','serious','critical')`
    )
    .execute()

  await db.schema
    .createTable('alert_events')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('page_id', 'bigint', (col) =>
      col.notNull().references('pages.id').onDelete('cascade'))
    .addColumn('audit_id', 'bigint', (col) =>
      col.notNull().references('audits.id').onDelete('cascade'))
    // Set null, not cascade: an alert is ABOUT its current audit, so retention
    // deleting the audit it compared against must not delete the alert.
    .addColumn('previous_audit_id', 'bigint', (col) =>
      col.references('audits.id').onDelete('set null'))
    .addColumn('kind', 'text', (col) => col.notNull())
    // When the regression was DETECTED (#14). Distinct from emailed_at because
    // #14 records the event and #15 sends it, as two separate steps.
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    // Null until a confirmed send (#15). It must stay null on delivery failure,
    // otherwise the send job cannot find the events it still owes.
    .addColumn('emailed_at', 'timestamptz')
    .addCheckConstraint('alert_events_kind_check', sql`kind in ('score_drop','new_critical')`)
    .execute()

  await sql`create unique index audits_public_uuid_idx on audits (public_uuid)`.execute(db)

  // Exactly the #12/#20 trend query. Anonymous audits are excluded because they
  // are only ever fetched by UUID.
  await sql`
    create index audits_page_created_idx on audits (page_id, created_at desc)
      where page_id is not null
  `.execute(db)

  await sql`create index violations_audit_idx on violations (audit_id)`.execute(db)

  // The #14 dedupe rule, keyed on detection rather than delivery.
  //
  // Two reasons it cannot key on emailed_at. #15 only sets that column on a
  // confirmed send, so it is null for exactly the rows dedupe must catch - and
  // NULLs never collide in a unique index, so the rule would silently permit
  // unlimited duplicate alerts. It would also be wrong in principle: whether a
  // page has already alerted today is a fact about detection, not about whether
  // an email provider happened to accept the message.
  //
  // The zone must be pinned: `created_at::date` alone is STABLE, not IMMUTABLE,
  // and Postgres refuses to index it.
  await sql`
    create unique index alert_events_one_per_page_per_day
      on alert_events (page_id, ((created_at at time zone 'UTC')::date))
  `.execute(db)

  await sql`create index alert_events_audit_idx on alert_events (audit_id)`.execute(db)
  await sql`create index alert_events_previous_audit_idx on alert_events (previous_audit_id)`.execute(db)
}

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable('alert_events').execute()
  await db.schema.dropTable('violations').execute()
  await db.schema.dropTable('audits').execute()
  await db.schema.dropTable('pages').execute()
  await db.schema.dropTable('sites').execute()
}
