import { vi } from 'vitest'
import type { PageModel, PageSummary } from '../../domain/models/page.js'
import type { PageHistory } from '../../domain/usecases/load-page-history.js'
import type { AddPageRepository } from '../protocols/db/page/add-page-repository.js'
import type {
  DeletePageRepository
} from '../protocols/db/page/delete-page-repository.js'
import type {
  DuePage, LoadDueReauditsRepository
} from '../protocols/db/page/load-due-reaudits-repository.js'
import type {
  LoadPageHistoryRepository
} from '../protocols/db/page/load-page-history-repository.js'
import type {
  LoadPageSummariesRepository
} from '../protocols/db/page/load-page-summaries-repository.js'
import type {
  SetPageMonitoringRepository
} from '../protocols/db/page/set-page-monitoring-repository.js'
import { mockAuditModel } from './mock-audit.js'

export const mockPageModel = (): PageModel => ({
  id: 'page-1',
  siteId: 'site-1',
  url: 'https://example.test/a',
  monitoringEnabled: true,
  createdAt: new Date('2026-07-29T10:00:00Z')
})

export const mockPageSummary = (): PageSummary => ({
  page: mockPageModel(),
  domain: 'example.test',
  latestAudit: mockAuditModel(),
  history: [{ score: 88, at: new Date('2026-07-28T10:00:00Z') }]
})

export const mockAddPageRepository = () => ({
  add: vi.fn<AddPageRepository['add']>(async () => ({
    outcome: 'added' as const,
    page: mockPageModel(),
    firstAudit: { ...mockAuditModel(), pageId: 'page-1' }
  }))
})

export const mockLoadPageSummariesRepository = () => ({
  loadSummariesForUser: vi.fn<LoadPageSummariesRepository['loadSummariesForUser']>(
    async () => [mockPageSummary()]
  )
})

export const mockSetPageMonitoringRepository = () => ({
  setMonitoringForUser: vi.fn<SetPageMonitoringRepository['setMonitoringForUser']>(
    async (_pageId, _userId, monitoringEnabled) => ({ ...mockPageModel(), monitoringEnabled })
  )
})

export const mockDeletePageRepository = () => ({
  deleteForUser: vi.fn<DeletePageRepository['deleteForUser']>(async () => true)
})

export const mockPageHistory = (): PageHistory => ({
  page: mockPageModel(),
  audits: [
    { ...mockAuditModel(), pageId: 'page-1', status: 'done', score: 71 },
    // A failed run in the middle: the point of the shape is that it survives
    // as a point, not that it is dropped or scored zero.
    { ...mockAuditModel(), pageId: 'page-1', status: 'failed', error: 'Navigation timed out' }
  ]
})

export const mockDuePages = (): DuePage[] => [
  { pageId: 'page-1', url: 'https://example.test/a', domain: 'example.test' },
  { pageId: 'page-2', url: 'https://other.test/b', domain: 'other.test' }
]

export const mockLoadDueReauditsRepository = () => ({
  loadDueForReaudit: vi.fn<LoadDueReauditsRepository['loadDueForReaudit']>(
    async () => mockDuePages()
  )
})

export const mockLoadPageHistoryRepository = () => ({
  loadHistoryForUser: vi.fn<LoadPageHistoryRepository['loadHistoryForUser']>(
    async () => mockPageHistory()
  )
})
