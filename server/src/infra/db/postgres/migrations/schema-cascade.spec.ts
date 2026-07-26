import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import { makeDatabase } from '../helpers/postgres-helper.js'
import type { Database } from '../database.js'

describe('schema deletion semantics', () => {
  let db: Kysely<Database>

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
  })

  afterAll(async () => {
    await db.destroy()
  })

  // Spec files share one database and run in parallel, so every fixture is
  // unique and every assertion is scoped to ids this test created.
  const makeFixture = async (): Promise<{
    pageId: string, previousAuditId: string, currentAuditId: string, anonymousAuditId: string
  }> => {
    const site = await db.insertInto('sites')
      .values({ domain: `${randomUUID()}.test` })
      .returning('id').executeTakeFirstOrThrow()

    const page = await db.insertInto('pages')
      .values({ site_id: site.id, url: 'https://cascade.test/a' })
      .returning('id').executeTakeFirstOrThrow()

    const previous = await db.insertInto('audits')
      .values({ page_id: page.id, url: 'https://cascade.test/a', status: 'done' })
      .returning('id').executeTakeFirstOrThrow()

    const current = await db.insertInto('audits')
      .values({ page_id: page.id, url: 'https://cascade.test/a', status: 'done' })
      .returning('id').executeTakeFirstOrThrow()

    const anonymous = await db.insertInto('audits')
      .values({ page_id: null, url: `https://${randomUUID()}.test/x`, status: 'done' })
      .returning('id').executeTakeFirstOrThrow()

    await db.insertInto('violations').values([
      {
        audit_id: current.id,
        rule_id: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        help_url: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        nodes: JSON.stringify([{ target: ['img'], html: '<img>' }])
      },
      {
        audit_id: anonymous.id,
        rule_id: 'label',
        impact: 'serious',
        description: 'Form elements must have labels',
        help_url: 'https://dequeuniversity.com/rules/axe/4.10/label',
        nodes: JSON.stringify([{ target: ['input'], html: '<input>' }])
      }
    ]).execute()

    await db.insertInto('alert_events')
      .values({
        page_id: page.id,
        audit_id: current.id,
        previous_audit_id: previous.id,
        kind: 'score_drop'
      })
      .execute()

    return {
      pageId: page.id,
      previousAuditId: previous.id,
      currentAuditId: current.id,
      anonymousAuditId: anonymous.id
    }
  }

  const auditExists = async (id: string): Promise<boolean> =>
    (await db.selectFrom('audits').select('id').where('id', '=', id).executeTakeFirst()) !== undefined

  const violationCountFor = async (auditId: string): Promise<number> =>
    (await db.selectFrom('violations').select('id').where('audit_id', '=', auditId).execute()).length

  it('deletes a page\'s audits, violations and alert events', async () => {
    const fixture = await makeFixture()

    await db.deleteFrom('pages').where('id', '=', fixture.pageId).execute()

    expect(await auditExists(fixture.currentAuditId)).toBe(false)
    expect(await violationCountFor(fixture.currentAuditId)).toBe(0)
    const alerts = await db.selectFrom('alert_events').select('id')
      .where('page_id', '=', fixture.pageId).execute()
    expect(alerts).toEqual([])
  })

  it('leaves anonymous audits untouched when a page is deleted', async () => {
    const fixture = await makeFixture()

    await db.deleteFrom('pages').where('id', '=', fixture.pageId).execute()

    expect(await auditExists(fixture.anonymousAuditId)).toBe(true)
    expect(await violationCountFor(fixture.anonymousAuditId)).toBe(1)
  })

  it('keeps an alert event when the audit it compared against is deleted', async () => {
    const fixture = await makeFixture()

    await db.deleteFrom('audits').where('id', '=', fixture.previousAuditId).execute()

    const alert = await db.selectFrom('alert_events').selectAll()
      .where('page_id', '=', fixture.pageId).executeTakeFirstOrThrow()
    expect(alert.previous_audit_id).toBeNull()
  })

  it('allows only one alert per page per UTC day', async () => {
    const fixture = await makeFixture()
    // The fixture's own alert already used today; use a fixed distant day so
    // this test does not depend on when it runs.
    const day = '2026-01-15'
    await db.insertInto('alert_events').values({
      page_id: fixture.pageId,
      audit_id: fixture.currentAuditId,
      kind: 'score_drop',
      created_at: new Date(`${day}T01:00:00Z`)
    }).execute()

    const sameDayAgain = db.insertInto('alert_events').values({
      page_id: fixture.pageId,
      audit_id: fixture.currentAuditId,
      kind: 'new_critical',
      created_at: new Date(`${day}T23:00:00Z`)
    }).execute()

    await expect(sameDayAgain).rejects.toThrow(/alert_events_one_per_page_per_day/)
  })

  it('dedupes alerts that have not been emailed yet', async () => {
    // The regression this pins: if the dedupe keyed on emailed_at, unsent
    // events would carry NULL there, and NULLs never collide in a unique
    // index - so the rule would silently permit unlimited duplicates for
    // exactly the rows it exists to catch.
    const fixture = await makeFixture()
    const day = '2026-02-20'
    await db.insertInto('alert_events').values({
      page_id: fixture.pageId,
      audit_id: fixture.currentAuditId,
      kind: 'score_drop',
      created_at: new Date(`${day}T09:00:00Z`)
    }).execute()

    const secondUnsent = db.insertInto('alert_events').values({
      page_id: fixture.pageId,
      audit_id: fixture.currentAuditId,
      kind: 'new_critical',
      created_at: new Date(`${day}T18:00:00Z`)
    }).execute()

    await expect(secondUnsent).rejects.toThrow(/alert_events_one_per_page_per_day/)

    const stored = await db.selectFrom('alert_events').selectAll()
      .where('page_id', '=', fixture.pageId)
      .where('emailed_at', 'is', null)
      .execute()
    expect(stored.every(row => row.emailed_at === null)).toBe(true)
  })

  it('leaves emailed_at null on insert, so the send job can find unsent alerts', async () => {
    const fixture = await makeFixture()

    const alert = await db.selectFrom('alert_events').selectAll()
      .where('page_id', '=', fixture.pageId).executeTakeFirstOrThrow()

    expect(alert.emailed_at).toBeNull()
    expect(alert.created_at).toBeInstanceOf(Date)
  })
})
