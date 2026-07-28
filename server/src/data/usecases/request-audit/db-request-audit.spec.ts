import { describe, expect, it, vi } from 'vitest'
import { DbRequestAudit } from './db-request-audit.js'
import {
  mockAddAuditRepository, mockAuditQueue, mockDeleteQueuedAuditRepository
} from '../../test/index.js'
import type { DnsResolver } from '../../protocols/net/dns-resolver.js'

const makeSut = (addresses: string[] = ['93.184.216.34']) => {
  const audits = mockAddAuditRepository()
  const deletes = mockDeleteQueuedAuditRepository()
  const queue = mockAuditQueue()
  const resolver = { resolve: vi.fn<DnsResolver['resolve']>(async () => addresses) }
  const sut = new DbRequestAudit(audits, deletes, queue, resolver)
  return { sut, audits, deletes, queue, resolver }
}

describe('DbRequestAudit', () => {
  it('validates, inserts, then enqueues - in that order', async () => {
    // Order is the point: enqueueing first lets the worker dequeue an id whose
    // row does not exist yet.
    const { sut, audits, queue } = makeSut()

    const result = await sut.request({ url: 'https://example.com/a' })

    expect(result.outcome).toBe('queued')
    expect(audits.add.mock.invocationCallOrder[0] as number)
      .toBeLessThan(queue.enqueue.mock.invocationCallOrder[0] as number)
    expect(queue.enqueue).toHaveBeenCalledWith({ auditId: 'audit-1' })
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
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a hostname that resolves to a private address', async () => {
    // Gate 1's other half. Without this the audit is queued, a browser is
    // launched, and the worker's guard fails it thirty seconds later - correct
    // but wasteful, and it fails #7's stated criteria.
    const { sut, audits, queue } = makeSut(['10.0.0.5'])

    expect(await sut.request({ url: 'https://internal.corp/' }))
      .toEqual({ outcome: 'rejected', reason: 'blocked-address' })
    expect(audits.add).not.toHaveBeenCalled()
    expect(queue.enqueue).not.toHaveBeenCalled()
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
    queue.enqueue.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const result = await sut.request({ url: 'https://example.com/a' })

    expect(result.outcome).toBe('queued')
    expect(queue.enqueue).toHaveBeenCalledTimes(2)
    expect(deletes.deleteIfQueued).not.toHaveBeenCalled()
  })

  it('deletes the row and reports unavailable when the queue stays down', async () => {
    const { sut, queue, deletes } = makeSut()
    queue.enqueue.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await sut.request({ url: 'https://example.com/a' })

    expect(result).toEqual({ outcome: 'unavailable' })
    // Nothing stranded: the row was acknowledged to nobody, so it goes.
    expect(deletes.deleteIfQueued).toHaveBeenCalledWith('audit-1')
  })

  it('still reports unavailable when the cleanup delete also fails', async () => {
    // This degrades to a stranded queued row, which is the accepted residual -
    // but it must not become a 500 on top of it.
    const { sut, queue, deletes } = makeSut()
    queue.enqueue.mockRejectedValue(new Error('ECONNREFUSED'))
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
