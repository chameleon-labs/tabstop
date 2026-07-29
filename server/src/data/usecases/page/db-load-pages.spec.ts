import { describe, expect, it } from 'vitest'
import { DbDeletePage } from './db-delete-page.js'
import { DbLoadPages } from './db-load-pages.js'
import { DbUpdatePage } from './db-update-page.js'
import {
  mockDeletePageRepository, mockLoadPageSummariesRepository, mockPageSummary,
  mockSetPageMonitoringRepository
} from '../../test/index.js'

describe('DbLoadPages', () => {
  it('returns the account\'s summaries alongside the cap the dashboard renders', async () => {
    const repository = mockLoadPageSummariesRepository()
    const sut = new DbLoadPages(repository, 10)

    expect(await sut.load('user-1')).toEqual({ pages: [mockPageSummary()], limit: 10 })
    expect(repository.loadSummariesForUser).toHaveBeenCalledWith('user-1')
  })

  it('still reports the cap for an account with no pages', async () => {
    // The empty state is most new users' first authenticated impression (#20),
    // and it has to be able to say how many pages they may add.
    const repository = mockLoadPageSummariesRepository()
    repository.loadSummariesForUser.mockResolvedValueOnce([])

    expect(await new DbLoadPages(repository, 10).load('user-1')).toEqual({ pages: [], limit: 10 })
  })
})

describe('DbUpdatePage', () => {
  it('passes both ids to the repository, never the page id alone', async () => {
    const repository = mockSetPageMonitoringRepository()
    const sut = new DbUpdatePage(repository)

    const updated = await sut.update({
      pageId: 'page-1', userId: 'user-1', monitoringEnabled: false
    })

    expect(repository.setMonitoringForUser).toHaveBeenCalledWith('page-1', 'user-1', false)
    expect(updated?.monitoringEnabled).toBe(false)
  })

  it('returns null when the account has no such page', async () => {
    const repository = mockSetPageMonitoringRepository()
    repository.setMonitoringForUser.mockResolvedValueOnce(null)

    expect(await new DbUpdatePage(repository).update({
      pageId: 'page-1', userId: 'someone-else', monitoringEnabled: true
    })).toBeNull()
  })
})

describe('DbDeletePage', () => {
  it('passes both ids to the repository, never the page id alone', async () => {
    const repository = mockDeletePageRepository()

    expect(await new DbDeletePage(repository).delete({ pageId: 'page-1', userId: 'user-1' }))
      .toBe(true)
    expect(repository.deleteForUser).toHaveBeenCalledWith('page-1', 'user-1')
  })

  it('returns false when the account has no such page', async () => {
    const repository = mockDeletePageRepository()
    repository.deleteForUser.mockResolvedValueOnce(false)

    expect(await new DbDeletePage(repository).delete({
      pageId: 'page-1', userId: 'someone-else'
    })).toBe(false)
  })
})
