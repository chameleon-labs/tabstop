import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql, type Kysely } from 'kysely'
import type { Database } from '../database.js'
import { makeDatabase } from '../helpers/postgres-helper.js'

describe('009 alert delivery state', () => {
  let db: Kysely<Database>

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
  })

  afterAll(async () => {
    await db.destroy()
  })

  const makeAlertEvent = async (): Promise<{ pageId: string, auditId: string }> => {
    const user = await db.insertInto('users')
      .values({ email: `${randomUUID()}@example.test`, password_digest: 'x' })
      .returning('id').executeTakeFirstOrThrow()
    const site = await db.insertInto('sites')
      .values({ user_id: user.id, domain: `${randomUUID()}.test` })
      .returning('id').executeTakeFirstOrThrow()
    const page = await db.insertInto('pages')
      .values({ site_id: site.id, url: `https://${randomUUID()}.test/a` })
      .returning('id').executeTakeFirstOrThrow()
    const audit = await db.insertInto('audits')
      .values({ page_id: page.id, url: `https://${randomUUID()}.test/a`, status: 'done' })
      .returning('id').executeTakeFirstOrThrow()

    return { pageId: page.id, auditId: audit.id }
  }

  const insertAlertEvent = async (
    pageId: string, auditId: string, emailedAt: Date | null, failedAt: Date | null, failureReason: string | null
  ): Promise<void> => {
    await sql`
      insert into alert_events (page_id, audit_id, kind, emailed_at, failed_at, failure_reason)
      values (${pageId}::bigint, ${auditId}::bigint, 'score_drop', ${emailedAt}, ${failedAt}, ${failureReason})
    `.execute(db)
  }

  it('adds nullable preview and terminal failure columns', async () => {
    const result = await sql<{
      column_name: string
      is_nullable: string
      character_maximum_length: number | null
    }>`
      select column_name, is_nullable, character_maximum_length
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'alert_events'
    `.execute(db)

    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_name: 'previewed_at', is_nullable: 'YES' }),
      expect.objectContaining({ column_name: 'failed_at', is_nullable: 'YES' }),
      expect.objectContaining({
        column_name: 'failure_reason',
        character_maximum_length: 200
      })
    ]))
  })

  it('leaves only unattempted and non-terminal events in the dispatcher index', async () => {
    const result = await sql<{ indexdef: string }>`
      select indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'alert_events_unsent_idx'
    `.execute(db)

    expect(result.rows).toHaveLength(1)
    const indexDefinition = result.rows[0]?.indexdef ?? ''
    expect(indexDefinition).toContain('WHERE ((emailed_at IS NULL) AND (failed_at IS NULL))')
  })

  it('rejects an alert event that is both emailed and failed', async () => {
    const { pageId, auditId } = await makeAlertEvent()

    await expect(insertAlertEvent(pageId, auditId, new Date(), new Date(), 'provider rejected it'))
      .rejects.toThrow(/alert_events_delivery_terminal_exclusive/)
  })

  it('requires a failure reason exactly when an alert event failed', async () => {
    const { pageId, auditId } = await makeAlertEvent()

    await expect(insertAlertEvent(pageId, auditId, null, null, 'provider rejected it'))
      .rejects.toThrow(/alert_events_failure_reason_pair/)
    await expect(insertAlertEvent(pageId, auditId, null, new Date(), null))
      .rejects.toThrow(/alert_events_failure_reason_pair/)
  })
})
