import { describe, expect, it } from 'vitest'
import type { Selectable } from 'kysely'
import { toAuditModel } from './audit-mapper.js'
import type { CountsByImpact } from '../../../../domain/models/impact.js'
import type { AuditsTable } from '../database.js'

const makeRow = (overrides: Partial<Selectable<AuditsTable>> = {}): Selectable<AuditsTable> => ({
  id: '1',
  public_uuid: '11111111-1111-1111-1111-111111111111',
  page_id: null,
  url: 'https://example.test/a',
  status: 'done',
  score: 87,
  counts_by_impact: { minor: 1, moderate: 2, serious: 3, critical: 4 },
  axe_version: '4.10.0',
  duration_ms: 1234,
  error: null,
  created_at: new Date('2026-07-26T10:00:00Z'),
  completed_at: new Date('2026-07-26T10:00:30Z'),
  settled: true,
  ...overrides
})

describe('toAuditModel', () => {
  it('renames every column to its domain name', () => {
    const model = toAuditModel(makeRow())

    expect(model).toEqual({
      id: '1',
      publicUuid: '11111111-1111-1111-1111-111111111111',
      pageId: null,
      url: 'https://example.test/a',
      status: 'done',
      score: 87,
      countsByImpact: { minor: 1, moderate: 2, serious: 3, critical: 4 },
      axeVersion: '4.10.0',
      durationMs: 1234,
      error: null,
      createdAt: new Date('2026-07-26T10:00:00Z'),
      completedAt: new Date('2026-07-26T10:00:30Z'),
      settled: true
    })
  })

  it('fills missing impact keys with zero', () => {
    // jsonb enforces no shape, so a row written outside this repository can be
    // missing keys that the domain type promises are present.
    const row = makeRow({ counts_by_impact: { serious: 2 } as unknown as CountsByImpact })

    expect(toAuditModel(row).countsByImpact)
      .toEqual({ minor: 0, moderate: 0, serious: 2, critical: 0 })
  })

  it('never lets a missing counts object produce a partial record', () => {
    const row = makeRow({ counts_by_impact: {} as unknown as CountsByImpact })

    expect(toAuditModel(row).countsByImpact)
      .toEqual({ minor: 0, moderate: 0, serious: 0, critical: 0 })
  })
})
