import { describe, expect, it } from 'vitest'
import { DbRunScheduledReaudits } from './db-run-scheduled-reaudits.js'
import { reauditDelayMs } from '../../../domain/services/reaudit-schedule.js'
import {
  mockAddScheduledAuditRepository, mockAuditQueue, mockDeleteQueuedAuditRepository,
  mockLoadDueReauditsRepository
} from '../../test/index.js'
import type { DuePage } from '../../protocols/db/page/load-due-reaudits-repository.js'

const MAX_PAGES = 500
const NOW = new Date('2026-08-01T02:00:00Z')

const makeSut = (maxPagesPerRun = MAX_PAGES) => {
  const pages = mockLoadDueReauditsRepository()
  const audits = mockAddScheduledAuditRepository()
  const deletes = mockDeleteQueuedAuditRepository()
  const queue = mockAuditQueue()
  const sut = new DbRunScheduledReaudits(pages, audits, deletes, queue, maxPagesPerRun)
  return { sut, pages, audits, deletes, queue }
}

const pagesOn = (domain: string, count: number): DuePage[] =>
  Array.from({ length: count }, (_value, index) => ({
    pageId: `page-${index}`, url: `https://${domain}/${index}`, domain
  }))

describe('DbRunScheduledReaudits', () => {
  it('creates one audit per due page and queues each one', async () => {
    const { sut, audits, queue } = makeSut()

    const summary = await sut.run(NOW)

    expect(audits.addScheduled.mock.calls.map(([params]) => params)).toEqual([
      { pageId: 'page-1', url: 'https://example.test/a', scheduledFor: '2026-08-01' },
      { pageId: 'page-2', url: 'https://other.test/b', scheduledFor: '2026-08-01' }
    ])
    expect(queue.enqueueOnce).toHaveBeenCalledTimes(2)
    expect(summary).toEqual({
      scheduledFor: '2026-08-01',
      pagesConsidered: 2,
      auditsEnqueued: 2,
      skippedDuplicate: 0,
      failed: 0,
      truncated: false
    })
  })

  it('asks for pages due since midnight UTC of the run day', async () => {
    // Not "since 24 hours ago". The day is the unit the constraint dedupes on,
    // and a rolling window would let a run that slipped an hour late re-audit
    // a page the previous run had already done.
    const { sut, pages } = makeSut()

    await sut.run(new Date('2026-08-01T23:30:00Z'))

    expect(pages.loadDueForReaudit).toHaveBeenCalledWith(
      new Date('2026-08-01T00:00:00.000Z'), MAX_PAGES
    )
  })

  it('stamps every row of one run with the same day, even across midnight', async () => {
    // Deriving the day per row - from each insert's own clock - splits a
    // fan-out that crosses midnight into two dates, and both halves satisfy
    // the unique index. The page gets audited twice.
    const { sut, audits } = makeSut()

    await sut.run(new Date('2026-08-01T23:59:59.999Z'))

    const days = audits.addScheduled.mock.calls.map(([params]) => params.scheduledFor)
    expect(new Set(days)).toEqual(new Set(['2026-08-01']))
  })

  it('gives each page its domain jitter, so one origin is not hit all at once', async () => {
    const { sut, pages, queue } = makeSut()
    pages.loadDueForReaudit.mockResolvedValueOnce(pagesOn('example.test', 3))

    await sut.run(NOW)

    const delays = queue.enqueueOnce.mock.calls.map(([, options]) => options?.delayMs)
    expect(delays).toEqual([
      reauditDelayMs('example.test', 0),
      reauditDelayMs('example.test', 1),
      reauditDelayMs('example.test', 2)
    ])
    // The property that matters more than the exact numbers: no two pages on
    // one host arrive together.
    expect(new Set(delays).size).toBe(3)
  })

  it('counts a page position per domain, not per run', async () => {
    // Positions counted across the whole run would make the offset depend on
    // where a page happened to sort - so adding one page to an unrelated
    // domain would move every later page's audit time, and the trend lines
    // this schedule exists to keep comparable would all shift.
    const { sut, pages, queue } = makeSut()
    pages.loadDueForReaudit.mockResolvedValueOnce([
      { pageId: 'a', url: 'https://one.test/a', domain: 'one.test' },
      { pageId: 'b', url: 'https://two.test/b', domain: 'two.test' },
      { pageId: 'c', url: 'https://one.test/c', domain: 'one.test' }
    ])

    await sut.run(NOW)

    const delays = queue.enqueueOnce.mock.calls.map(([, options]) => options?.delayMs)
    expect(delays).toEqual([
      reauditDelayMs('one.test', 0),
      reauditDelayMs('two.test', 0),
      reauditDelayMs('one.test', 1)
    ])
  })

  it('treats a page another run already scheduled as skipped, not failed', async () => {
    // The unique index refusing the insert is the second idempotency layer
    // working, not an error - so it must not be counted as one, or a
    // legitimately overlapping run would look like a broken night.
    const { sut, audits, queue, deletes } = makeSut()
    audits.addScheduled.mockResolvedValueOnce(null)

    const summary = await sut.run(NOW)

    expect(summary.skippedDuplicate).toBe(1)
    expect(summary.auditsEnqueued).toBe(1)
    expect(summary.failed).toBe(0)
    expect(queue.enqueueOnce).toHaveBeenCalledTimes(1)
    // Nothing to clean up: the row belongs to the run that won.
    expect(deletes.deleteIfQueued).not.toHaveBeenCalled()
  })

  it('removes the audit row when the queue genuinely refuses the job', async () => {
    // A queued audit nothing will run shows on the dashboard as permanently in
    // progress - and it would keep the page OUT of tomorrow's eligibility
    // query, so one lost enqueue would cost the page every future night too.
    const { sut, queue, deletes } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('redis is down'))

    const summary = await sut.run(NOW)

    expect(deletes.deleteIfQueued.mock.calls.map(([id]) => id))
      .toEqual(['audit-for-page-1', 'audit-for-page-2'])
    expect(summary).toMatchObject({ auditsEnqueued: 0, failed: 2 })
  })

  it('keeps the row when the queue may have taken the job but lost the reply', async () => {
    // `unknown`, not `failed`. Deleting here would leave a job pointing at an
    // audit that no longer exists.
    const { sut, queue, deletes } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('timeout'))
    queue.has.mockResolvedValue(true)

    const summary = await sut.run(NOW)

    expect(deletes.deleteIfQueued).not.toHaveBeenCalled()
    expect(summary.auditsEnqueued).toBe(2)
  })

  it('keeps going when one page cannot be inserted', async () => {
    // One page's database error must not end the night for every page after
    // it in the list.
    const { sut, audits, queue } = makeSut()
    audits.addScheduled.mockRejectedValueOnce(new Error('deadlock detected'))

    const summary = await sut.run(NOW)

    expect(summary).toMatchObject({ failed: 1, auditsEnqueued: 1 })
    expect(queue.enqueueOnce).toHaveBeenCalledTimes(1)
  })

  it('reports a run the per-run cap cut short', async () => {
    // Silently auditing the first N pages and dropping the rest is the failure
    // mode of an invisible scheduler: nothing errors, some customers simply
    // stop being monitored.
    const { sut, pages } = makeSut(2)
    pages.loadDueForReaudit.mockResolvedValueOnce(pagesOn('example.test', 2))

    const summary = await sut.run(NOW)

    expect(pages.loadDueForReaudit).toHaveBeenCalledWith(expect.any(Date), 2)
    expect(summary.truncated).toBe(true)
  })

  it('reports a night with nothing to do rather than staying silent', async () => {
    // A summary that only appears when there is work is one nobody notices the
    // absence of - which is exactly how a scheduler that stopped firing goes
    // unnoticed until customers ask why the alerts stopped.
    const { sut, pages, queue } = makeSut()
    pages.loadDueForReaudit.mockResolvedValueOnce([])

    const summary = await sut.run(NOW)

    expect(queue.enqueueOnce).not.toHaveBeenCalled()
    expect(summary).toEqual({
      scheduledFor: '2026-08-01',
      pagesConsidered: 0,
      auditsEnqueued: 0,
      skippedDuplicate: 0,
      failed: 0,
      truncated: false
    })
  })

  it('creates the audit row before handing the job to the queue', async () => {
    // Reversed, a worker can dequeue an id whose row does not exist yet.
    const { sut, audits, queue } = makeSut()

    await sut.run(NOW)

    expect(audits.addScheduled.mock.invocationCallOrder[0] as number)
      .toBeLessThan(queue.enqueueOnce.mock.invocationCallOrder[0] as number)
  })
})
