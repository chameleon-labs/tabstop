import { vi } from 'vitest'
import type { AddAuditRepository } from '../protocols/db/audit/add-audit-repository.js'
import type {
  DeleteQueuedAuditRepository
} from '../protocols/db/audit/delete-queued-audit-repository.js'
import type { AuditJob, AuditJobQueue } from '../protocols/queue/audit-job-queue.js'
import type { AuditModel } from '../../domain/models/audit.js'
import type { AuditPageResult, PageAuditor } from '../protocols/audit/page-auditor.js'
import type {
  LoadAuditByIdRepository
} from '../protocols/db/audit/load-audit-by-id-repository.js'
import type { MarkDoneRepository } from '../protocols/db/audit/mark-done-repository.js'
import type { MarkFailedRepository } from '../protocols/db/audit/mark-failed-repository.js'
import type { MarkRunningRepository } from '../protocols/db/audit/mark-running-repository.js'
import type {
  ReplaceViolationsRepository
} from '../protocols/db/violation/replace-violations-repository.js'

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
  claimForRun: vi.fn<MarkRunningRepository['claimForRun']>(
    async () => new Date('2026-07-27T10:00:00Z')
  ),
  releaseClaim: vi.fn<MarkRunningRepository['releaseClaim']>(async () => { /* no-op */ }),
  markDone: vi.fn<MarkDoneRepository['markDone']>(async () => { /* no-op */ }),
  markFailed: vi.fn<MarkFailedRepository['markFailed']>(async () => { /* no-op */ })
})

export const mockReplaceViolationsRepository = () => ({
  replaceAll: vi.fn<ReplaceViolationsRepository['replaceAll']>(async () => { /* no-op */ })
})

export const mockPageAuditor = () => ({
  audit: vi.fn<PageAuditor['audit']>(async () => mockAuditPageResult())
})

export const mockAddAuditRepository = () => ({
  add: vi.fn<AddAuditRepository['add']>(async () => mockAuditModel())
})

export const mockDeleteQueuedAuditRepository = () => ({
  deleteIfQueued: vi.fn<DeleteQueuedAuditRepository['deleteIfQueued']>(
    async () => { /* no-op */ }
  )
})

export const mockAuditQueue = () => ({
  enqueueOnce: vi.fn<AuditJobQueue['enqueueOnce']>(async () => { /* no-op */ }),
  // Absent by default: the interesting case is a queue that lost the reply
  // but did accept the job, and each spec opts into that explicitly.
  has: vi.fn<AuditJobQueue['has']>(async () => false)
})
