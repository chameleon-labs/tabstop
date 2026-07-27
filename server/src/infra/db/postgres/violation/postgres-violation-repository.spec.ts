import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Kysely } from 'kysely'
import { makeDatabase } from '../helpers/postgres-helper.js'
import { PostgresViolationRepository } from './postgres-violation-repository.js'
import type { AddViolationParams } from '../../../../data/protocols/db/violation/violation-params.js'
import type { Database } from '../database.js'

describe('PostgresViolationRepository', () => {
  let db: Kysely<Database>
  let sut: PostgresViolationRepository

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    db = makeDatabase(url)
    sut = new PostgresViolationRepository(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  const makeAudit = async (): Promise<string> => {
    const audit = await db.insertInto('audits')
      .values({ page_id: null, url: `https://${randomUUID()}.test/x`, status: 'done' })
      .returning('id').executeTakeFirstOrThrow()
    return audit.id
  }

  const contrast: AddViolationParams = {
    ruleId: 'color-contrast',
    impact: 'serious',
    description: 'Elements must have sufficient colour contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
    nodes: [{ target: ['#main > p'], html: '<p>hi</p>' }]
  }

  it('stores and returns a violation', async () => {
    const auditId = await makeAudit()

    await sut.replaceAll(auditId, [contrast])
    const loaded = await sut.loadByAuditId(auditId)

    expect(loaded).toHaveLength(1)
    expect(loaded[0]).toMatchObject({
      auditId,
      ruleId: 'color-contrast',
      impact: 'serious',
      description: 'Elements must have sufficient colour contrast',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast'
    })
  })

  it('round-trips the jsonb nodes intact', async () => {
    const auditId = await makeAudit()

    await sut.replaceAll(auditId, [contrast])
    const loaded = await sut.loadByAuditId(auditId)

    // Structural comparison: jsonb reorders object keys, so comparing
    // serialised JSON would fail spuriously.
    expect(loaded[0]?.nodes).toEqual([{ target: ['#main > p'], html: '<p>hi</p>' }])
  })

  it('stores several violations at once', async () => {
    const auditId = await makeAudit()

    await sut.replaceAll(auditId, [
      contrast,
      {
        ruleId: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        nodes: [{ target: ['img'], html: '<img>' }]
      }
    ])

    const loaded = await sut.loadByAuditId(auditId)
    expect(loaded.map(violation => violation.ruleId)).toEqual(['color-contrast', 'image-alt'])
  })

  it('accepts an empty list, because a clean page is the success case', async () => {
    const auditId = await makeAudit()

    await expect(sut.replaceAll(auditId, [])).resolves.toBeUndefined()
    expect(await sut.loadByAuditId(auditId)).toEqual([])
  })

  it('returns an empty array for an audit with no violations', async () => {
    const auditId = await makeAudit()

    expect(await sut.loadByAuditId(auditId)).toEqual([])
  })

  it('replaces an audit\'s violations instead of appending to them', async () => {
    // The queue redelivers, and `violations` has no uniqueness constraint, so
    // a second write of the same result must not double the rows.
    const auditId = await makeAudit()
    const violation = {
      ruleId: 'image-alt',
      impact: 'critical' as const,
      description: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      nodes: [{ target: ['img'], html: '<img>' }]
    }

    await sut.replaceAll(auditId, [violation])
    await sut.replaceAll(auditId, [violation])

    expect(await sut.loadByAuditId(auditId)).toHaveLength(1)
  })

  it('clears an audit\'s violations when the page comes back clean', async () => {
    const auditId = await makeAudit()
    await sut.replaceAll(auditId, [{
      ruleId: 'label',
      impact: 'critical' as const,
      description: 'Form elements must have labels',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/label',
      nodes: [{ target: ['input'], html: '<input>' }]
    }])

    await sut.replaceAll(auditId, [])

    expect(await sut.loadByAuditId(auditId)).toEqual([])
  })

  it('serialises concurrent replacements instead of duplicating them', async () => {
    // The transaction alone makes one replacement atomic but does not order
    // two: under READ COMMITTED both would delete zero rows and both insert.
    // The audit row lock is what makes this safe.
    const auditId = await makeAudit()
    const violation = {
      ruleId: 'image-alt',
      impact: 'critical' as const,
      description: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      nodes: [{ target: ['img'], html: '<img>' }]
    }

    await Promise.all([
      sut.replaceAll(auditId, [violation]),
      sut.replaceAll(auditId, [violation]),
      sut.replaceAll(auditId, [violation])
    ])

    expect(await sut.loadByAuditId(auditId)).toHaveLength(1)
  })

  it('stores a violation axe gave no severity, rather than discarding it', async () => {
    // Dropping it would mark an audit done while omitting a real finding.
    const auditId = await makeAudit()

    await sut.replaceAll(auditId, [{
      ruleId: 'some-rule-without-impact',
      impact: null,
      description: 'A rule whose checks carry no severity',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/x',
      nodes: [{ target: ['div'], html: '<div>' }]
    }])

    const stored = await sut.loadByAuditId(auditId)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.impact).toBeNull()
  })
})
