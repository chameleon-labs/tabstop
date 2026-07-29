import { describe, expect, it, vi } from 'vitest'
import { DbAddPage } from './db-add-page.js'
import {
  mockAddPageRepository, mockAuditQueue, mockDeleteQueuedAuditRepository
} from '../../test/index.js'
import type { DnsResolver } from '../../protocols/net/dns-resolver.js'
import type { AuditJobQueue } from '../../protocols/queue/audit-job-queue.js'
import type { UrlPolicy } from '../../../domain/services/url-safety.js'

/**
 * A stub, not the real policy - this spec is about the usecase's
 * orchestration, and every range and port rule the real policy enforces is
 * covered exhaustively beside that implementation with no mocks at all.
 */
const stubPolicy: UrlPolicy = {
  isAllowedPort: (port) => port === 80 || port === 443,
  isBlockedAddress: (address) => !address.startsWith('93.184.216.'),
  isIpLiteral: (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
}

const LIMIT = 10

const makeSut = (addresses: string[] = ['93.184.216.34']) => {
  const pages = mockAddPageRepository()
  const deletes = mockDeleteQueuedAuditRepository()
  const queue = mockAuditQueue()
  const resolver = { resolve: vi.fn<DnsResolver['resolve']>(async () => addresses) }
  const sut = new DbAddPage(pages, deletes, queue, resolver, stubPolicy, LIMIT)
  return { sut, pages, deletes, queue, resolver }
}

describe('DbAddPage', () => {
  it('stores the host and the canonical url, and reports the first audit', async () => {
    const { sut, pages, queue } = makeSut()

    const result = await sut.add({ userId: 'user-1', url: 'https://Example.com:443/pricing#top' })

    expect(pages.add).toHaveBeenCalledWith({
      userId: 'user-1',
      // Host, lowercased by URL. A default port is dropped and the fragment,
      // which the server never sees, is stripped - so `/pricing#top` and
      // `/pricing` cannot become two pages audited twice.
      domain: 'example.com',
      url: 'https://example.com/pricing',
      limit: LIMIT
    })
    expect(result).toEqual({
      outcome: 'added',
      page: expect.objectContaining({ id: 'page-1' }),
      // The public uuid, never the internal id.
      firstAuditId: '11111111-1111-1111-1111-111111111111'
    })
    expect(queue.enqueueOnce).toHaveBeenCalledWith({ auditId: 'audit-1' })
  })

  it('enqueues only after the repository has committed', async () => {
    const { sut, pages, queue } = makeSut()
    const order: string[] = []
    pages.add.mockImplementationOnce(async (...args) => {
      order.push('commit')
      return await mockAddPageRepository().add(...args)
    })
    queue.enqueueOnce.mockImplementationOnce(async () => { order.push('enqueue') })

    await sut.add({ userId: 'user-1', url: 'https://example.com/' })

    // A job handed to Redis inside the transaction survives a rollback and
    // points at a page that does not exist.
    expect(order).toEqual(['commit', 'enqueue'])
  })

  it('rejects a url the policy refuses, without touching the database', async () => {
    const { sut, pages } = makeSut()

    expect(await sut.add({ userId: 'user-1', url: 'ftp://example.com/' }))
      .toEqual({ outcome: 'rejected', reason: 'blocked-scheme' })
    expect(await sut.add({ userId: 'user-1', url: 'not a url' }))
      .toEqual({ outcome: 'rejected', reason: 'invalid-url' })
    expect(await sut.add({ userId: 'user-1', url: 'https://example.com:8080/' }))
      .toEqual({ outcome: 'rejected', reason: 'blocked-port' })
    expect(pages.add).not.toHaveBeenCalled()
  })

  it('rejects a host that resolves into blocked space', async () => {
    // Cheaper to refuse once than to fail an audit every night for a page
    // nobody will think to delete.
    const { sut, pages } = makeSut(['10.0.0.1'])

    expect(await sut.add({ userId: 'user-1', url: 'https://internal.example.com/' }))
      .toEqual({ outcome: 'rejected', reason: 'blocked-address' })
    expect(pages.add).not.toHaveBeenCalled()
  })

  it('rejects a host that answers with one safe and one blocked address', async () => {
    const { sut } = makeSut(['93.184.216.34', '127.0.0.1'])

    expect((await sut.add({ userId: 'user-1', url: 'https://example.com/' })).outcome)
      .toBe('rejected')
  })

  it('carries the limit back so the caller can render the cap', async () => {
    const { sut, pages, queue } = makeSut()
    pages.add.mockResolvedValueOnce({ outcome: 'limit-reached' })

    expect(await sut.add({ userId: 'user-1', url: 'https://example.com/' }))
      .toEqual({ outcome: 'limit-reached', limit: LIMIT })
    expect(queue.enqueueOnce).not.toHaveBeenCalled()
  })

  it('passes a duplicate straight through', async () => {
    const { sut, pages, queue } = makeSut()
    pages.add.mockResolvedValueOnce({ outcome: 'duplicate' })

    expect(await sut.add({ userId: 'user-1', url: 'https://example.com/' }))
      .toEqual({ outcome: 'duplicate' })
    expect(queue.enqueueOnce).not.toHaveBeenCalled()
  })

  it('keeps the page but removes the audit when the queue will not take the job', async () => {
    const { sut, deletes, queue } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('redis is down'))

    const result = await sut.add({ userId: 'user-1', url: 'https://example.com/' })

    // The page is genuinely tracked - refusing it because Redis blinked would
    // be the wrong trade - but a queued row nothing will run would render as
    // permanently in progress.
    expect(result).toEqual({
      outcome: 'added',
      page: expect.objectContaining({ id: 'page-1' }),
      firstAuditId: null
    })
    expect(deletes.deleteIfQueued).toHaveBeenCalledWith('audit-1')
  })

  it('keeps the audit when the queue lost the reply but did accept the job', async () => {
    const { sut, deletes, queue } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('timeout'))
    queue.has = vi.fn<AuditJobQueue['has']>(async () => true)

    const result = await sut.add({ userId: 'user-1', url: 'https://example.com/' })

    // Deleting the row here would leave a job pointing at an audit that no
    // longer exists.
    expect(result).toEqual({
      outcome: 'added',
      page: expect.objectContaining({ id: 'page-1' }),
      firstAuditId: '11111111-1111-1111-1111-111111111111'
    })
    expect(deletes.deleteIfQueued).not.toHaveBeenCalled()
  })

  it('still reports the page when the cleanup delete itself fails', async () => {
    const { sut, deletes, queue } = makeSut()
    queue.enqueueOnce.mockRejectedValue(new Error('redis is down'))
    deletes.deleteIfQueued.mockRejectedValue(new Error('and postgres too'))

    expect((await sut.add({ userId: 'user-1', url: 'https://example.com/' })).outcome)
      .toBe('added')
  })

  it('does not read the queue depth', async () => {
    // The backlog cap exists to stop anonymous submissions filling the queue.
    // Refusing a signed-in account's page because strangers are busy is not
    // what it is for, and the page would be added but never audited.
    const { sut, queue } = makeSut()

    await sut.add({ userId: 'user-1', url: 'https://example.com/' })

    expect(queue.backlogCount).not.toHaveBeenCalled()
  })
})
