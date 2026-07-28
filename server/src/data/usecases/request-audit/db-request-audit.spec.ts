import { describe, expect, it, vi } from 'vitest'
import { DbRequestAudit } from './db-request-audit.js'
import {
  mockAddAuditRepository, mockAuditQueue, mockDeleteQueuedAuditRepository
} from '../../test/index.js'
import type { DnsResolver } from '../../protocols/net/dns-resolver.js'
import type { AuditJobQueue } from '../../protocols/queue/audit-job-queue.js'
import { DEFAULT_URL_POLICY } from '../../../domain/services/url-safety.js'

const makeSut = (addresses: string[] = ['93.184.216.34']) => {
  const audits = mockAddAuditRepository()
  const deletes = mockDeleteQueuedAuditRepository()
  const queue = mockAuditQueue()
  const resolver = { resolve: vi.fn<DnsResolver['resolve']>(async () => addresses) }
  const sut = new DbRequestAudit(audits, deletes, queue, resolver)
  return { sut, audits, deletes, queue, resolver }
}

describe('DbRequestAudit queue depth', () => {
  /**
   * The gap the per-IP rate limit cannot close. A bucket bounds ONE source;
   * the queue is shared by all of them, so enough distinct addresses - each
   * politely inside its own allowance - still drive the backlog to whatever
   * length they collectively want. Nothing downstream refuses it either:
   * AUDIT_CONCURRENCY bounds how many audits run at once, not how many wait,
   * and each waiting one is a Redis job plus a row that a user is polling.
   */
  const deepQueue = (waiting: number) => {
    const queue = mockAuditQueue()
    return Object.assign(queue, {
      waitingCount: vi.fn<AuditJobQueue['waitingCount']>(async () => waiting)
    })
  }

  const sutWith = (queue: ReturnType<typeof deepQueue>, maxDepth = 100) => {
    const audits = mockAddAuditRepository()
    const deletes = mockDeleteQueuedAuditRepository()
    const resolver = { resolve: vi.fn<DnsResolver['resolve']>(async () => ['93.184.216.34']) }
    const sut = new DbRequestAudit(
      audits, deletes, queue, resolver, DEFAULT_URL_POLICY, maxDepth
    )
    return { sut, audits, deletes, queue }
  }

  it('refuses a new audit once the queue is already at its cap', async () => {
    const { sut, audits, queue } = sutWith(deepQueue(100), 100)

    const result = await sut.request({ url: 'https://example.com/a' })

    expect(result.outcome).toBe('unavailable')
    // Checked BEFORE the insert, so a refusal strands no row for the cleanup
    // path to find - the client simply retries later for a fresh id.
    expect(audits.add).not.toHaveBeenCalled()
    expect(queue.enqueueOnce).not.toHaveBeenCalled()
  })

  it('accepts while the queue is still under the cap', async () => {
    const { sut, audits } = sutWith(deepQueue(99), 100)

    expect((await sut.request({ url: 'https://example.com/a' })).outcome).toBe('queued')
    expect(audits.add).toHaveBeenCalledOnce()
  })

  it('accepts when the queue cannot say how deep it is', async () => {
    // Fails OPEN, deliberately. A depth check that cannot answer must not
    // become a second way for a sick Redis to refuse submissions: the enqueue
    // below already handles a genuinely unreachable queue, and it does so by
    // retrying first. Turning "I could not measure" into a 503 would make an
    // unmeasurable queue indistinguishable from a full one.
    const queue = mockAuditQueue()
    const failing = Object.assign(queue, {
      waitingCount: vi.fn<AuditJobQueue['waitingCount']>(async () => {
        throw new Error('redis unreachable')
      })
    })
    const { sut, audits } = sutWith(failing, 100)

    expect((await sut.request({ url: 'https://example.com/a' })).outcome).toBe('queued')
    expect(audits.add).toHaveBeenCalledOnce()
  })

  it('overshoots under a simultaneous burst, then refuses until it drains', async () => {
    // The soft edge, pinned rather than papered over.
    //
    // Reading the depth and then enqueueing is check-then-act: everything in
    // flight during that window has already passed the check, so a burst of
    // simultaneous submissions - across instances too - all get in and the
    // queue ends up over the cap by roughly the size of the burst.
    //
    // What the cap does bound is the STEADY STATE. Every request arriving
    // after the burst sees the raised depth and is refused, so the queue
    // cannot keep growing; it spikes and then drains. That is the property
    // worth having here, and it is the second half of this test.
    //
    // Closing the window properly needs an atomic reservation in Redis -
    // released on both the insert and the enqueue failing, with a TTL for the
    // process dying in between. That is a distributed semaphore, and it would
    // have to fail OPEN to respect this branch's rule that Redis is not a hard
    // dependency of the write path - at which point it is not atomic when it
    // matters either. The soft edge is the better trade for a backstop.
    const { sut: burstSut } = sutWith(deepQueue(99), 100)

    const burst = await Promise.all(
      Array.from({ length: 10 }, async () =>
        await burstSut.request({ url: 'https://example.com/a' }))
    )

    expect(burst.every((result) => result.outcome === 'queued')).toBe(true)

    // ...and the queue, now over its cap, turns the next one away.
    const { sut: afterSut, audits } = sutWith(deepQueue(109), 100)

    expect((await afterSut.request({ url: 'https://example.com/a' })).outcome)
      .toBe('unavailable')
    expect(audits.add).not.toHaveBeenCalled()
  })

  it('checks depth only after the URL has been accepted', async () => {
    // A blocked address must still get its specific rejection rather than a
    // generic "try again later" that tells the caller nothing.
    const { sut, queue } = sutWith(deepQueue(100), 100)

    const result = await sut.request({ url: 'file:///etc/passwd' })

    expect(result).toEqual({ outcome: 'rejected', reason: 'blocked-scheme' })
    expect(queue.waitingCount).not.toHaveBeenCalled()
  })
})

describe('DbRequestAudit', () => {
  it('validates, inserts, then enqueues - in that order', async () => {
    // Order is the point: enqueueing first lets the worker dequeue an id whose
    // row does not exist yet.
    const { sut, audits, queue } = makeSut()

    const result = await sut.request({ url: 'https://example.com/a' })

    expect(result.outcome).toBe('queued')
    expect(audits.add.mock.invocationCallOrder[0] as number)
      .toBeLessThan(queue.enqueueOnce.mock.invocationCallOrder[0] as number)
    expect(queue.enqueueOnce).toHaveBeenCalledWith({ auditId: 'audit-1' })
  })

  it('rejects an unsafe URL without touching the database or the queue', async () => {
    const { sut, audits, queue } = makeSut()

    const cases = [
      ['file:///etc/passwd', 'blocked-scheme'],
      ['data:text/html,<h1>x', 'blocked-scheme'],
      ['javascript:alert(1)', 'blocked-scheme'],
      ['http://169.254.169.254/', 'blocked-address'],
      ['http://127.0.0.1/', 'blocked-address'],
      ['http://example.com:8080/', 'blocked-port'],
      ['not a url', 'invalid-url']
    ] as const

    for (const [url, reason] of cases) {
      expect(await sut.request({ url })).toEqual({ outcome: 'rejected', reason })
    }

    expect(audits.add).not.toHaveBeenCalled()
    expect(queue.enqueueOnce).not.toHaveBeenCalled()
  })

  it('rejects a hostname that resolves to a private address', async () => {
    // Gate 1's other half. Without this the audit is queued, a browser is
    // launched, and the worker's guard fails it thirty seconds later - correct
    // but wasteful, and it fails #7's stated criteria.
    const { sut, audits, queue } = makeSut(['10.0.0.5'])

    expect(await sut.request({ url: 'https://internal.corp/' }))
      .toEqual({ outcome: 'rejected', reason: 'blocked-address' })
    expect(audits.add).not.toHaveBeenCalled()
    expect(queue.enqueueOnce).not.toHaveBeenCalled()
  })

  it('rejects a host answering with one public and one private address', async () => {
    // Taking only the first answer would wave this straight through.
    const { sut, audits } = makeSut(['93.184.216.34', '10.0.0.5'])

    expect((await sut.request({ url: 'https://mixed.test/' })).outcome).toBe('rejected')
    expect(audits.add).not.toHaveBeenCalled()
  })

  it('rejects when resolution fails, rather than accepting', async () => {
    const { sut, audits } = makeSut([])

    expect((await sut.request({ url: 'https://nowhere.invalid/' })).outcome).toBe('rejected')
    expect(audits.add).not.toHaveBeenCalled()
  })

  it('does not resolve a literal address, which was already checked', async () => {
    const { sut, resolver } = makeSut()

    await sut.request({ url: 'http://93.184.216.34/' })

    expect(resolver.resolve).not.toHaveBeenCalled()
  })

  it('rejects a URL carrying credentials before anything else happens', async () => {
    // They would otherwise be stored and handed back by the public result
    // endpoint, and cached for an hour.
    const { sut, audits } = makeSut()

    expect(await sut.request({ url: 'https://alice:secret@example.com/' }))
      .toEqual({ outcome: 'rejected', reason: 'blocked-credentials' })
    expect(audits.add).not.toHaveBeenCalled()
  })

  it('stores the normalised URL rather than the raw input', async () => {
    const { sut, audits } = makeSut()

    await sut.request({ url: 'HTTPS://Example.COM/Path' })

    // Host folded, path left alone - the path is significant to a server.
    expect(audits.add).toHaveBeenCalledWith({ url: 'https://example.com/Path', pageId: null })
  })

  it('creates an anonymous audit, with no page attached', async () => {
    const { sut, audits } = makeSut()

    await sut.request({ url: 'https://example.com/a' })

    expect(audits.add.mock.calls[0]?.[0].pageId).toBeNull()
  })

  it('retries a failing enqueue before giving up', async () => {
    // Most enqueue failures are a blip. Absorbing them here keeps the delete
    // path for a genuine outage.
    const { sut, queue, deletes } = makeSut()
    queue.enqueueOnce.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await sut.request({ url: 'https://example.com/a' })

    expect(result.outcome).toBe('queued')
    expect(queue.enqueueOnce).toHaveBeenCalledTimes(2)
    expect(deletes.deleteIfQueued).not.toHaveBeenCalled()
  })

  it('deletes the row and reports unavailable when the queue stays down', async () => {
    const { sut, queue, deletes } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await sut.request({ url: 'https://example.com/a' })

    expect(result).toEqual({ outcome: 'unavailable' })
    // Nothing stranded: the row was acknowledged to nobody, so it goes.
    expect(deletes.deleteIfQueued).toHaveBeenCalledWith('audit-1')
  })

  it('keeps the audit when the queue turns out to have accepted it', async () => {
    // An enqueue can fail from here while Redis committed the job and lost the
    // reply. Deleting the row then would leave a job pointing at an audit that
    // no longer exists - a guaranteed failure, for work that was accepted.
    const { sut, queue, deletes } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('ECONNREFUSED'))
    queue.has.mockResolvedValue(true)

    const result = await sut.request({ url: 'https://example.com/a' })

    expect(result.outcome).toBe('queued')
    expect(deletes.deleteIfQueued).not.toHaveBeenCalled()
  })

  it('retries the same audit rather than submitting a second one', async () => {
    // The queue dedupes on the audit id, so a retry only enqueues once - but
    // only as long as every attempt asks for the same audit.
    const { sut, queue } = makeSut()
    queue.enqueueOnce.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    await sut.request({ url: 'https://example.com/a' })

    expect(queue.enqueueOnce.mock.calls).toEqual([
      [{ auditId: 'audit-1' }],
      [{ auditId: 'audit-1' }]
    ])
  })

  it('deletes the row when the queue cannot say whether it accepted', async () => {
    // A job that fails once with "audit no longer exists" is a better outcome
    // than a row nothing ever recovers.
    const { sut, queue, deletes } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('ECONNREFUSED'))
    queue.has.mockRejectedValue(new Error('ECONNREFUSED'))

    expect((await sut.request({ url: 'https://example.com/a' })).outcome).toBe('unavailable')
    expect(deletes.deleteIfQueued).toHaveBeenCalledWith('audit-1')
  })

  it('does not hang when the queue never answers', async () => {
    // BullMQ retries a lost Redis forever, so `add` does not reject - it
    // hangs. Measured at five minutes. Without a bound the request never
    // answers and none of the recovery above is reachable.
    const { sut, queue, deletes } = makeSut()
    queue.enqueueOnce.mockImplementation(async () => await new Promise<never>(() => {}))
    queue.has.mockImplementation(async () => await new Promise<never>(() => {}))

    const result = await sut.request({ url: 'https://example.com/a' })

    expect(result).toEqual({ outcome: 'unavailable' })
    expect(deletes.deleteIfQueued).toHaveBeenCalledWith('audit-1')
  }, 30_000)

  it('still reports unavailable when the cleanup delete also fails', async () => {
    // This degrades to a stranded queued row, which is the accepted residual -
    // but it must not become a 500 on top of it.
    const { sut, queue, deletes } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('ECONNREFUSED'))
    deletes.deleteIfQueued.mockRejectedValue(new Error('database down'))

    expect(await sut.request({ url: 'https://example.com/a' }))
      .toEqual({ outcome: 'unavailable' })
  })

  it('lets a database failure escape, rather than reporting unavailable', async () => {
    // `unavailable` means the queue is down and the row is gone. A database
    // failure is neither, and hiding it behind the same outcome would make a
    // 503 the answer to everything.
    const { sut, audits } = makeSut()
    audits.add.mockRejectedValueOnce(new Error('database down'))

    await expect(sut.request({ url: 'https://example.com/a' })).rejects.toThrow('database down')
  })
})
