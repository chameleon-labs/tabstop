import {vi} from 'vitest';
import type {AddAuditRepository} from '../protocols/db/audit/add-audit-repository.js';
import type {AddScheduledAuditRepository} from '../protocols/db/audit/add-scheduled-audit-repository.js';
import type {
  AddOnDemandAuditRepository,
  ReleaseOnDemandAuditRepository,
} from '../protocols/db/audit/add-on-demand-audit-repository.js';
import type {DeleteQueuedAuditRepository} from '../protocols/db/audit/delete-queued-audit-repository.js';
import type {
  ReclaimAbandonedAuditsRepository,
  StaleAudit,
} from '../protocols/db/audit/reclaim-abandoned-audits-repository.js';
import type {AuditJobQueue} from '../protocols/queue/audit-job-queue.js';
import type {AuditModel} from '../../domain/models/audit.js';
import type {AuditPageResult, PageAuditor} from '../protocols/audit/page-auditor.js';
import type {LoadAuditByIdRepository} from '../protocols/db/audit/load-audit-by-id-repository.js';
import type {CompleteAuditRepository} from '../protocols/db/audit/complete-audit-repository.js';
import type {MarkFailedRepository} from '../protocols/db/audit/mark-failed-repository.js';
import type {MarkRunningRepository} from '../protocols/db/audit/mark-running-repository.js';
import type {ReplaceViolationsRepository} from '../protocols/db/violation/replace-violations-repository.js';

export const mockAuditModel = (): AuditModel => ({
  id: 'audit-1',
  publicUuid: '11111111-1111-1111-1111-111111111111',
  pageId: null,
  url: 'https://example.test/a',
  status: 'queued',
  score: null,
  countsByImpact: {minor: 0, moderate: 0, serious: 0, critical: 0},
  axeVersion: null,
  durationMs: null,
  error: null,
  createdAt: new Date('2026-07-27T10:00:00Z'),
  completedAt: null,
  scheduledFor: null,
  settled: true,
});

export const mockAuditPageResult = (): AuditPageResult => ({
  violations: [
    {
      ruleId: 'image-alt',
      impact: 'critical',
      description: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      nodes: [
        {target: ['img'], html: '<img>'},
        {target: ['img:nth-child(2)'], html: '<img>'},
      ],
    },
    {
      ruleId: 'color-contrast',
      impact: 'serious',
      description: 'Elements must meet contrast thresholds',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
      nodes: [{target: ['p'], html: '<p>'}],
    },
  ],
  axeVersion: '4.12.1',
  durationMs: 1234,
  settled: true,
});

export const mockLoadAuditByIdRepository = () => ({
  loadById: vi.fn<LoadAuditByIdRepository['loadById']>(() => Promise.resolve(mockAuditModel())),
});

export const mockAuditStatusRepository = () => ({
  claimForRun: vi.fn<MarkRunningRepository['claimForRun']>(() => Promise.resolve(new Date('2026-07-27T10:00:00Z'))),
  releaseClaim: vi.fn<MarkRunningRepository['releaseClaim']>(async () => {}),
  complete: vi.fn<CompleteAuditRepository['complete']>(async () => {}),
  markFailed: vi.fn<MarkFailedRepository['markFailed']>(async () => {}),
});

export const mockReplaceViolationsRepository = () => ({
  replaceAll: vi.fn<ReplaceViolationsRepository['replaceAll']>(async () => {}),
});

export const mockPageAuditor = () => ({
  audit: vi.fn<PageAuditor['audit']>(() => Promise.resolve(mockAuditPageResult())),
});

export const mockAddAuditRepository = () => ({
  add: vi.fn<AddAuditRepository['add']>(() => Promise.resolve(mockAuditModel())),
});

export const mockAddScheduledAuditRepository = () => ({
  addScheduled: vi.fn<AddScheduledAuditRepository['addScheduled']>((params) =>
    Promise.resolve({
      ...mockAuditModel(),
      id: `audit-for-${params.pageId}`,
      pageId: params.pageId,
    }),
  ),
  loadStaleInFlight: vi.fn<ReclaimAbandonedAuditsRepository['loadStaleInFlight']>(() => Promise.resolve([])),
  markAbandoned: vi.fn<ReclaimAbandonedAuditsRepository['markAbandoned']>(() => Promise.resolve(true)),
});

export const mockStaleAudit = (auditId: string, minutesAgo: number): StaleAudit => ({
  auditId,
  createdAt: `2026-07-01 00:${String(minutesAgo).padStart(2, '0')}:00.000000+00`,
});

export const mockPagedStaleAudits = (candidates: StaleAudit[]) =>
  vi.fn<ReclaimAbandonedAuditsRepository['loadStaleInFlight']>((_olderThan, limit, after) =>
    Promise.resolve(
      candidates.filter((candidate) => after === null || candidate.createdAt > after.createdAt).slice(0, limit),
    ),
  );

export const mockAddOnDemandAuditRepository = () => ({
  addOnDemand: vi.fn<AddOnDemandAuditRepository['addOnDemand']>((params) =>
    Promise.resolve({
      outcome: 'added' as const,
      audit: {...mockAuditModel(), id: `audit-for-${params.pageId}`, pageId: params.pageId},
    }),
  ),
});

export const mockReleaseOnDemandAuditRepository = () => ({
  releaseOnDemand: vi.fn<ReleaseOnDemandAuditRepository['releaseOnDemand']>(async () => {}),
});

export const mockDeleteQueuedAuditRepository = () => ({
  deleteIfQueued: vi.fn<DeleteQueuedAuditRepository['deleteIfQueued']>(async () => {}),
});

export const mockAuditQueue = () => ({
  enqueueOnce: vi.fn<AuditJobQueue['enqueueOnce']>(async () => {}),
  has: vi.fn<AuditJobQueue['has']>(() => Promise.resolve(false)),
  isPending: vi.fn<AuditJobQueue['isPending']>(() => Promise.resolve(true)),
  backlogCount: vi.fn<AuditJobQueue['backlogCount']>(() => Promise.resolve(0)),
});
