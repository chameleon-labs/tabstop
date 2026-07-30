import { vi } from 'vitest'
import type { AddAuditRepository } from '../protocols/db/audit/add-audit-repository.js'
import type {
  AddScheduledAuditRepository
} from '../protocols/db/audit/add-scheduled-audit-repository.js'
import type {
  DeleteQueuedAuditRepository
} from '../protocols/db/audit/delete-queued-audit-repository.js'
import type {
  ReclaimAbandonedAuditsRepository, StaleAudit
} from '../protocols/db/audit/reclaim-abandoned-audits-repository.js'
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

/**
 * The scheduler's audit-side repository: creating the night's rows, and
 * retiring the ones nothing ever ran. One mock because one class implements
 * both, and the run holds it as a single dependency.
 *
 * Nothing stale by default - the reaper is a maintenance path, and a mock that
 * found work every time would make every unrelated spec assert around it.
 */
export const mockAddScheduledAuditRepository = () => ({
  // A distinct id per page, because the scheduler's whole job is one audit per
  // page - a shared id would let a spec pass while the run created one audit
  // in total and enqueued it repeatedly.
  addScheduled: vi.fn<AddScheduledAuditRepository['addScheduled']>(async (params) => ({
    ...mockAuditModel(), id: `audit-for-${params.pageId}`, pageId: params.pageId
  })),
  loadStaleInFlight: vi.fn<ReclaimAbandonedAuditsRepository['loadStaleInFlight']>(async () => []),
  markAbandoned: vi.fn<ReclaimAbandonedAuditsRepository['markAbandoned']>(async () => true)
})

/** A stale candidate, dated so a cursor can order it. */
export const mockStaleAudit = (auditId: string, minutesAgo: number): StaleAudit => ({
  auditId, createdAt: new Date(Date.UTC(2026, 6, 1, 0, minutesAgo))
})

/**
 * Serves stale candidates through the cursor, so a paging spec exercises the
 * loop rather than a stub that agrees with it. A mock returning the same first
 * batch forever is exactly the starvation the loop exists to prevent, and
 * would let it pass.
 */
export const mockPagedStaleAudits = (candidates: StaleAudit[]) =>
  vi.fn<ReclaimAbandonedAuditsRepository['loadStaleInFlight']>(
    async (_olderThan, limit, after) => candidates
      .filter((candidate) => after === null || candidate.createdAt > after.createdAt)
      .slice(0, limit)
  )

export const mockDeleteQueuedAuditRepository = () => ({
  deleteIfQueued: vi.fn<DeleteQueuedAuditRepository['deleteIfQueued']>(
    async () => { /* no-op */ }
  )
})

export const mockAuditQueue = () => ({
  enqueueOnce: vi.fn<AuditJobQueue['enqueueOnce']>(async () => { /* no-op */ }),
  // Absent by default: the interesting case is a queue that lost the reply
  // but did accept the job, and each spec opts into that explicitly.
  has: vi.fn<AuditJobQueue['has']>(async () => false),
  // Pending by default, which is the opposite default to `has` and for the
  // opposite reason: the reclaim path acts when a job is GONE, so a mock that
  // reported absence would have every spec retiring rows incidentally.
  isPending: vi.fn<AuditJobQueue['isPending']>(async () => true),
  // An empty queue by default: depth is not what most of these specs are
  // about, and a mock that saturated by accident would fail all of them.
  backlogCount: vi.fn<AuditJobQueue['backlogCount']>(async () => 0)
})
