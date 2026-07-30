import { vi } from 'vitest'
import type { PageModel, PageSummary } from '../../domain/models/page.js'
import type { AddPageRepository } from '../protocols/db/page/add-page-repository.js'
import type {
  DeletePageRepository
} from '../protocols/db/page/delete-page-repository.js'
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
