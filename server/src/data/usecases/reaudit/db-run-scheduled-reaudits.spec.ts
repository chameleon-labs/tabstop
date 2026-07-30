import { describe, expect, it } from 'vitest'
import { DbRunScheduledReaudits } from './db-run-scheduled-reaudits.js'
import { reauditDelayMs } from '../../../domain/services/reaudit-schedule.js'
import {
  mockAddScheduledAuditRepository, mockAuditQueue, mockDeleteQueuedAuditRepository,
  mockAuditModel, mockLoadDueReauditsRepository, mockPagedDueReauditsRepository
} from '../../test/index.js'
import type { DuePage } from '../../protocols/db/page/load-due-reaudits-repository.js'

const BATCH = 100
const MAX_PAGES = 500
const STALE_AFTER_MS = 12 * 60 * 60 * 1000
const NOW = new Date('2026-08-01T02:00:00Z')

const makeSut = (limits: { batchSize?: number, maxPagesPerRun?: number } = {}) => {
  const pages = mockLoadDueReauditsRepository()
  const audits = mockAddScheduledAuditRepository()
  const deletes = mockDeleteQueuedAuditRepository()
  const queue = mockAuditQueue()
  const sut = new DbRunScheduledReaudits(
    pages, audits, deletes, queue,
    limits.batchSize ?? BATCH, limits.maxPagesPerRun ?? MAX_PAGES, STALE_AFTER_MS
  )
  return { sut, pages, audits, deletes, queue }
}

/**
 * Ids are zero-padded because the cursor compares them, and the paged mock
 * compares them as strings: unpadded, `page-9` sorts after `page-10` and the
 * spec would be exercising a cursor the database would never produce.
 */
const pagesOn = (domain: string, count: number): DuePage[] =>
  Array.from({ length: count }, (_value, index) => ({
    pageId: `page-${String(index).padStart(4, '0')}`,
    url: `https://${domain}/${index}`,
    domain
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
      abandonedReclaimed: 0,
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
      expect.objectContaining({ dayStart: new Date('2026-08-01T00:00:00.000Z') })
    )
  })

  it('looks for abandoned audits older than the stale cutoff', async () => {
    // Age is the filter, not the verdict - the queue decides. See the reclaim
    // specs below for why that distinction is the whole point.
    const { sut, audits } = makeSut()

    await sut.run(NOW)

    expect(audits.loadStaleInFlight).toHaveBeenCalledWith(
      new Date(NOW.getTime() - STALE_AFTER_MS), BATCH
    )
  })

  it('asks for one row more than it means to use', async () => {
    // So "was anything left" is answered by the query. A batch that comes back
    // exactly full cannot tell a run that was cut short from one that ended on
    // the boundary, and guessing wrong in the reassuring direction is how a
    // truncated night reports itself as complete.
    const { sut, pages } = makeSut({ batchSize: 100 })

    await sut.run(NOW)

    expect(pages.loadDueForReaudit).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 101, after: null })
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
    // progress, and it keeps the page out of the worklist until something
    // retires it - so the row goes now rather than waiting for the reclaim
    // path to notice it a day later.
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

  it('keeps paging until every due page is scheduled', async () => {
    // The whole point of the loop. A single capped query drops everything past
    // the cap - and because the cut is by page id, it drops the SAME pages
    // every night, so those accounts quietly stop being monitored while the
    // run reports success.
    const pages = mockPagedDueReauditsRepository(pagesOn('example.test', 250))
    const audits = mockAddScheduledAuditRepository()
    const sut = new DbRunScheduledReaudits(
      pages, audits, mockDeleteQueuedAuditRepository(), mockAuditQueue(),
      100, MAX_PAGES, STALE_AFTER_MS
    )

    const summary = await sut.run(NOW)

    expect(summary.pagesConsidered).toBe(250)
    expect(audits.addScheduled).toHaveBeenCalledTimes(250)
    expect(summary.truncated).toBe(false)
  })

  it('advances the cursor past the last page of each batch', async () => {
    // Keyset, never an offset: every page the run schedules gains an audit in
    // flight and leaves the predicate, so an offset would step over exactly as
    // many pages as the previous batch handled - auditing a third of them and
    // reporting a clean night.
    const all = pagesOn('example.test', 250)
    const pages = mockPagedDueReauditsRepository(all)
    const sut = new DbRunScheduledReaudits(
      pages, mockAddScheduledAuditRepository(), mockDeleteQueuedAuditRepository(),
      mockAuditQueue(), 100, MAX_PAGES, STALE_AFTER_MS
    )

    await sut.run(NOW)

    expect(pages.loadDueForReaudit.mock.calls.map(([query]) => query.after))
      .toEqual([null, 'page-0099', 'page-0199'])
  })

  it('does not call a full final batch truncated', async () => {
    // The off-by-one this asks the query to settle. With exactly as many due
    // pages as the batch holds, inferring "there must be more" from a full
    // batch reports a complete run as cut short - and an alert that fires on a
    // healthy night is one that gets muted.
    const all = pagesOn('example.test', 100)
    const pages = mockPagedDueReauditsRepository(all)
    const sut = new DbRunScheduledReaudits(
      pages, mockAddScheduledAuditRepository(), mockDeleteQueuedAuditRepository(),
      mockAuditQueue(), 100, MAX_PAGES, STALE_AFTER_MS
    )

    const summary = await sut.run(NOW)

    expect(summary.pagesConsidered).toBe(100)
    expect(summary.truncated).toBe(false)
  })

  it('reports a run its circuit breaker cut short', async () => {
    // Not the normal path any more - the run pages through everything. This
    // fires when the ceiling is reached with pages still due, which means the
    // eligibility predicate is not excluding what it should rather than that
    // the product got popular.
    const all = pagesOn('example.test', 250)
    const pages = mockPagedDueReauditsRepository(all)
    const sut = new DbRunScheduledReaudits(
      pages, mockAddScheduledAuditRepository(), mockDeleteQueuedAuditRepository(),
      mockAuditQueue(), 100, 200, STALE_AFTER_MS
    )

    const summary = await sut.run(NOW)

    expect(summary.pagesConsidered).toBe(200)
    expect(summary.truncated).toBe(true)
  })

  it('keeps one domain\'s stagger running across a batch boundary', async () => {
    // Positions are counted for the whole run, not per batch. Reset at each
    // boundary, the first page of every batch would land on its domain's base
    // offset - so the pages that straddle a boundary arrive together at the
    // origin the stagger exists to protect.
    const all = pagesOn('example.test', 4)
    const pages = mockPagedDueReauditsRepository(all)
    const queue = mockAuditQueue()
    const sut = new DbRunScheduledReaudits(
      pages, mockAddScheduledAuditRepository(), mockDeleteQueuedAuditRepository(),
      queue, 2, MAX_PAGES, STALE_AFTER_MS
    )

    await sut.run(NOW)

    expect(queue.enqueueOnce.mock.calls.map(([, options]) => options?.delayMs)).toEqual([
      reauditDelayMs('example.test', 0),
      reauditDelayMs('example.test', 1),
      reauditDelayMs('example.test', 2),
      reauditDelayMs('example.test', 3)
    ])
  })

  describe('reclaiming abandoned audits', () => {
    it('retires an old unfinished audit whose job the queue no longer holds', async () => {
      // The row that would otherwise hide its page from every future run.
      const { sut, audits, queue } = makeSut()
      audits.loadStaleInFlight.mockResolvedValueOnce(['audit-7'])
      queue.has.mockResolvedValue(false)

      const summary = await sut.run(NOW)

      expect(audits.markAbandoned).toHaveBeenCalledWith('audit-7', expect.any(String))
      expect(summary.abandonedReclaimed).toBe(1)
    })

    it('leaves an old audit alone while its job still exists', async () => {
      // The whole reason age is not the test. On a queue that has not drained,
      // every real pending audit is old too - retiring those would schedule
      // their pages again and pile a second night of work onto the backlog.
      const { sut, audits, queue } = makeSut()
      audits.loadStaleInFlight.mockResolvedValueOnce(['audit-7'])
      queue.has.mockResolvedValue(true)

      const summary = await sut.run(NOW)

      expect(audits.markAbandoned).not.toHaveBeenCalled()
      expect(summary.abandonedReclaimed).toBe(0)
    })

    it('leaves an old audit alone when the queue cannot answer at all', async () => {
      // Fails CLOSED, the opposite of the same lookup in audit-submission, and
      // for a different consequence: there an unanswerable queue costs one
      // stray job, here it would mark live audits as abandoned and schedule
      // duplicates for their pages. A Redis blip during the nightly run must
      // not manufacture work out of healthy rows.
      const { sut, audits, queue } = makeSut()
      audits.loadStaleInFlight.mockResolvedValueOnce(['audit-7'])
      queue.has.mockRejectedValue(new Error('redis is down'))

      const summary = await sut.run(NOW)

      expect(audits.markAbandoned).not.toHaveBeenCalled()
      expect(summary.abandonedReclaimed).toBe(0)
    })

    it('reclaims before building the worklist, so a freed page is scheduled tonight', async () => {
      const { sut, audits, pages, queue } = makeSut()
      audits.loadStaleInFlight.mockResolvedValueOnce(['audit-7'])
      queue.has.mockResolvedValue(false)

      await sut.run(NOW)

      expect(audits.markAbandoned.mock.invocationCallOrder[0] as number)
        .toBeLessThan(pages.loadDueForReaudit.mock.invocationCallOrder[0] as number)
    })

    it('does not count a row another run had already retired', async () => {
      const { sut, audits, queue } = makeSut()
      audits.loadStaleInFlight.mockResolvedValueOnce(['audit-7'])
      queue.has.mockResolvedValue(false)
      audits.markAbandoned.mockResolvedValueOnce(false)

      expect((await sut.run(NOW)).abandonedReclaimed).toBe(0)
    })

    it('still runs the night when reclaiming cannot even start', async () => {
      // Maintenance failing is not a reason to skip the actual work, and the
      // same rows are still there tomorrow.
      const { sut, audits } = makeSut()
      audits.loadStaleInFlight.mockRejectedValueOnce(new Error('the database is down'))

      const summary = await sut.run(NOW)

      expect(summary.abandonedReclaimed).toBe(0)
      expect(summary.auditsEnqueued).toBe(2)
    })
  })

  describe('shutting down mid-run', () => {
    it('stops at the next page rather than running to completion', async () => {
      // A full fan-out is far longer than the worker's shutdown grace, so
      // without this a SIGTERM reaches the force-exit timer - and a hard exit
      // can land between creating an audit row and queueing its job, stranding
      // exactly the row the reclaim path then has to clean up.
      const pages = mockPagedDueReauditsRepository(pagesOn('example.test', 50))
      const audits = mockAddScheduledAuditRepository()
      const controller = new AbortController()
      audits.addScheduled.mockImplementation(async (params) => {
        controller.abort()
        return { ...mockAuditModel(), id: `audit-for-${params.pageId}`, pageId: params.pageId }
      })
      const sut = new DbRunScheduledReaudits(
        pages, audits, mockDeleteQueuedAuditRepository(), mockAuditQueue(),
        10, MAX_PAGES, STALE_AFTER_MS
      )

      const summary = await sut.run(NOW, controller.signal)

      expect(summary.pagesConsidered).toBe(1)
      expect(summary.truncated).toBe(true)
    })

    it('does not start at all when it is already too late', async () => {
      const pages = mockPagedDueReauditsRepository(pagesOn('example.test', 50))
      const audits = mockAddScheduledAuditRepository()
      const sut = new DbRunScheduledReaudits(
        pages, audits, mockDeleteQueuedAuditRepository(), mockAuditQueue(),
        10, MAX_PAGES, STALE_AFTER_MS
      )

      const summary = await sut.run(NOW, AbortSignal.abort())

      expect(pages.loadDueForReaudit).not.toHaveBeenCalled()
      expect(summary).toMatchObject({ pagesConsidered: 0, truncated: true })
    })
  })

  it('counts a page whose cleanup also failed, and moves on', async () => {
    // Both the enqueue and the delete failing leaves a `queued` row with no
    // job. Retrying the delete here cannot help - the outage that failed it
    // fails the retry - so the run records the failure and the row's exclusion
    // expires with the in-flight grace window instead of lasting forever.
    const { sut, queue, deletes } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('redis is down'))
    deletes.deleteIfQueued.mockRejectedValue(new Error('the database is down too'))

    const summary = await sut.run(NOW)

    expect(summary).toMatchObject({ failed: 2, auditsEnqueued: 0 })
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
      abandonedReclaimed: 0,
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
