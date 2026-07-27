import { vi } from 'vitest'
import type { AuditModel } from '../../domain/models/audit.js'
import type { AuditPageResult, PageAuditor } from '../protocols/audit/page-auditor.js'
import type {
  LoadAuditByIdRepository
} from '../protocols/db/audit/load-audit-by-id-repository.js'
import type { MarkDoneRepository } from '../protocols/db/audit/mark-done-repository.js'
import type { MarkFailedRepository } from '../protocols/db/audit/mark-failed-repository.js'
import type { MarkRunningRepository } from '../protocols/db/audit/mark-running-repository.js'
import type { AddViolationsRepository } from '../protocols/db/violation/add-violations-repository.js'

export const mockAuditModel = (): AuditModel => ({
  id: 'audit-1',
  publicUuid: '11111111-1111-1111-1111-111111111111',
  pageId: null,
  url: 'https://example.test/a',
  status: 'queued',
  score: null,
  countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
  axeVersion: null,
  durationMs: null,
  error: null,
  createdAt: new Date('2026-07-27T10:00:00Z'),
  completedAt: null,
  settled: true
})

export const mockAuditPageResult = (): AuditPageResult => ({
  violations: [
    {
      ruleId: 'image-alt',
      impact: 'critical',
      description: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      nodes: [{ target: ['img'], html: '<img>' }, { target: ['img:nth-child(2)'], html: '<img>' }]
    },
    {
      ruleId: 'color-contrast',
      impact: 'serious',
      description: 'Elements must meet contrast thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
      nodes: [{ target: ['p'], html: '<p>' }]
    }
  ],
  axeVersion: '4.12.1',
  durationMs: 1234,
  settled: true
})

export const mockLoadAuditByIdRepository = () => ({
  loadById: vi.fn<LoadAuditByIdRepository['loadById']>(async () => mockAuditModel())
})

export const mockAuditStatusRepository = () => ({
  markRunning: vi.fn<MarkRunningRepository['markRunning']>(async () => { /* no-op */ }),
  markDone: vi.fn<MarkDoneRepository['markDone']>(async () => { /* no-op */ }),
  markFailed: vi.fn<MarkFailedRepository['markFailed']>(async () => { /* no-op */ })
})

export const mockAddViolationsRepository = () => ({
  addMany: vi.fn<AddViolationsRepository['addMany']>(async () => { /* no-op */ })
})

export const mockPageAuditor = () => ({
  audit: vi.fn<PageAuditor['audit']>(async () => mockAuditPageResult())
})
