import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DbLoadPageHistory } from './db-load-page-history.js'
import { mockLoadPageHistoryRepository, mockPageHistory } from '../../test/index.js'

describe('DbLoadPageHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-30T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('turns the day count into a boundary and passes both ids', async () => {
    const repository = mockLoadPageHistoryRepository()
    const sut = new DbLoadPageHistory(repository)

    await sut.load({ pageId: 'page-1', userId: 'user-1', days: 90 })

    // Computed here rather than left to `now() - interval` in SQL: a boundary
    // the caller can see is one a spec can pin.
    expect(repository.loadHistoryForUser).toHaveBeenCalledWith(
      'page-1', 'user-1', new Date('2026-05-01T12:00:00Z')
    )
  })

  it('honours a one-day window exactly', async () => {
    const repository = mockLoadPageHistoryRepository()

    await new DbLoadPageHistory(repository).load({
      pageId: 'page-1', userId: 'user-1', days: 1
    })

    expect(repository.loadHistoryForUser).toHaveBeenCalledWith(
      'page-1', 'user-1', new Date('2026-07-29T12:00:00Z')
    )
  })

  it('returns the history the repository found', async () => {
    const repository = mockLoadPageHistoryRepository()

    expect(await new DbLoadPageHistory(repository).load({
      pageId: 'page-1', userId: 'user-1', days: 90
    })).toEqual(mockPageHistory())
  })

  it('returns null when the account has no such page', async () => {
    const repository = mockLoadPageHistoryRepository()
    repository.loadHistoryForUser.mockResolvedValueOnce(null)

    expect(await new DbLoadPageHistory(repository).load({
      pageId: 'page-1', userId: 'someone-else', days: 90
    })).toBeNull()
  })
})
