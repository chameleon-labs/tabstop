import {describe, expect, it, vi} from 'vitest';
import {DbRequestAudit} from './db-request-audit.js';
import {mockAddAuditRepository, mockAuditQueue, mockDeleteQueuedAuditRepository} from '../../test/index.js';
import type {DnsResolver} from '../../protocols/net/dns-resolver.js';
import type {AuditJobQueue} from '../../protocols/queue/audit-job-queue.js';
import type {UrlPolicy} from '../../../domain/services/url-safety.js';

const stubPolicy: UrlPolicy = {
  isAllowedPort: (port) => port === 80 || port === 443,
  isBlockedAddress: (address) => !address.startsWith('93.184.216.'),
  isIpLiteral: (host) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host),
};

const makeSut = (addresses: string[] = ['93.184.216.34']) => {
  const audits = mockAddAuditRepository();
  const deletes = mockDeleteQueuedAuditRepository();
  const queue = mockAuditQueue();
  const resolver = {resolve: vi.fn<DnsResolver['resolve']>(() => Promise.resolve(addresses))};
  const sut = new DbRequestAudit(audits, deletes, queue, resolver, stubPolicy);
  return {sut, audits, deletes, queue, resolver};
};

describe('DbRequestAudit queue depth', () => {
  const deepQueue = (backlog: number) => {
    const queue = mockAuditQueue();
    return Object.assign(queue, {
      backlogCount: vi.fn<AuditJobQueue['backlogCount']>(() => Promise.resolve(backlog)),
    });
  };

  const sutWith = (queue: ReturnType<typeof deepQueue>, maxDepth = 100) => {
    const audits = mockAddAuditRepository();
    const deletes = mockDeleteQueuedAuditRepository();
    const resolver = {resolve: vi.fn<DnsResolver['resolve']>(() => Promise.resolve(['93.184.216.34']))};
    const sut = new DbRequestAudit(audits, deletes, queue, resolver, stubPolicy, maxDepth);
    return {sut, audits, deletes, queue};
  };

  it('refuses a new audit once the queue is already at its cap', async () => {
    const {sut, audits, queue} = sutWith(deepQueue(100), 100);

    const result = await sut.request({url: 'https://example.com/a'});

    expect(result.outcome).toBe('unavailable');
    expect(audits.add).not.toHaveBeenCalled();
    expect(queue.enqueueOnce).not.toHaveBeenCalled();
  });

  it('accepts while the queue is still under the cap', async () => {
    const {sut, audits} = sutWith(deepQueue(99), 100);

    expect((await sut.request({url: 'https://example.com/a'})).outcome).toBe('queued');
    expect(audits.add).toHaveBeenCalledOnce();
  });

  it('accepts when the queue cannot say how deep it is', async () => {
    const queue = mockAuditQueue();
    const failing = Object.assign(queue, {
      backlogCount: vi.fn<AuditJobQueue['backlogCount']>(() => Promise.reject(new Error('redis unreachable'))),
    });
    const {sut, audits} = sutWith(failing, 100);

    expect((await sut.request({url: 'https://example.com/a'})).outcome).toBe('queued');
    expect(audits.add).toHaveBeenCalledOnce();
  });

  it('overshoots under a simultaneous burst, then refuses until it drains', async () => {
    const {sut: burstSut} = sutWith(deepQueue(99), 100);

    const burst = await Promise.all(
      Array.from({length: 10}, async () => await burstSut.request({url: 'https://example.com/a'})),
    );

    expect(burst.every((result) => result.outcome === 'queued')).toBe(true);

    const {sut: afterSut, audits} = sutWith(deepQueue(109), 100);

    expect((await afterSut.request({url: 'https://example.com/a'})).outcome).toBe('unavailable');
    expect(audits.add).not.toHaveBeenCalled();
  });

  it('checks depth only after the URL has been accepted', async () => {
    const {sut, queue} = sutWith(deepQueue(100), 100);

    const result = await sut.request({url: 'file:///etc/passwd'});

    expect(result).toEqual({outcome: 'rejected', reason: 'blocked-scheme'});
    expect(queue.backlogCount).not.toHaveBeenCalled();
  });
});

describe('DbRequestAudit', () => {
  it('validates, inserts, then enqueues - in that order', async () => {
    const {sut, audits, queue} = makeSut();

    const result = await sut.request({url: 'https://example.com/a'});

    expect(result.outcome).toBe('queued');
    expect(audits.add.mock.invocationCallOrder[0] as number).toBeLessThan(
      queue.enqueueOnce.mock.invocationCallOrder[0] as number,
    );
    expect(queue.enqueueOnce).toHaveBeenCalledWith({auditId: 'audit-1'});
  });

  it('rejects an unsafe URL without touching the database or the queue', async () => {
    const {sut, audits, queue} = makeSut();

    const cases = [
      ['file:///etc/passwd', 'blocked-scheme'],
      ['data:text/html,<h1>x', 'blocked-scheme'],
      // oxlint-disable-next-line no-script-url -- the blocked input under test
      ['javascript:alert(1)', 'blocked-scheme'],
      ['http://169.254.169.254/', 'blocked-address'],
      ['http://127.0.0.1/', 'blocked-address'],
      ['http://example.com:8080/', 'blocked-port'],
      ['not a url', 'invalid-url'],
    ] as const;

    for (const [url, reason] of cases) {
      expect(await sut.request({url})).toEqual({outcome: 'rejected', reason});
    }

    expect(audits.add).not.toHaveBeenCalled();
    expect(queue.enqueueOnce).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to a private address', async () => {
    const {sut, audits, queue} = makeSut(['10.0.0.5']);

    expect(await sut.request({url: 'https://internal.corp/'})).toEqual({
      outcome: 'rejected',
      reason: 'blocked-address',
    });
    expect(audits.add).not.toHaveBeenCalled();
    expect(queue.enqueueOnce).not.toHaveBeenCalled();
  });

  it('rejects a host answering with one public and one private address', async () => {
    const {sut, audits} = makeSut(['93.184.216.34', '10.0.0.5']);

    expect((await sut.request({url: 'https://mixed.test/'})).outcome).toBe('rejected');
    expect(audits.add).not.toHaveBeenCalled();
  });

  it('rejects when resolution fails, rather than accepting', async () => {
    const {sut, audits} = makeSut([]);

    expect((await sut.request({url: 'https://nowhere.invalid/'})).outcome).toBe('rejected');
    expect(audits.add).not.toHaveBeenCalled();
  });

  it('does not resolve a literal address, which was already checked', async () => {
    const {sut, resolver} = makeSut();

    await sut.request({url: 'http://93.184.216.34/'});

    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('rejects a URL carrying credentials before anything else happens', async () => {
    const {sut, audits} = makeSut();

    expect(await sut.request({url: 'https://alice:secret@example.com/'})).toEqual({
      outcome: 'rejected',
      reason: 'blocked-credentials',
    });
    expect(audits.add).not.toHaveBeenCalled();
  });

  it('stores the normalised URL rather than the raw input', async () => {
    const {sut, audits} = makeSut();

    await sut.request({url: 'HTTPS://Example.COM/Path'});

    expect(audits.add).toHaveBeenCalledWith({url: 'https://example.com/Path', pageId: null});
  });

  it('creates an anonymous audit, with no page attached', async () => {
    const {sut, audits} = makeSut();

    await sut.request({url: 'https://example.com/a'});

    expect(audits.add.mock.calls[0]?.[0].pageId).toBeNull();
  });

  it('retries a failing enqueue before giving up', async () => {
    const {sut, queue, deletes} = makeSut();
    queue.enqueueOnce.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await sut.request({url: 'https://example.com/a'});

    expect(result.outcome).toBe('queued');
    expect(queue.enqueueOnce).toHaveBeenCalledTimes(2);
    expect(deletes.deleteIfQueued).not.toHaveBeenCalled();
  });

  it('deletes the row and reports unavailable when the queue stays down', async () => {
    const {sut, queue, deletes} = makeSut();
    queue.enqueueOnce.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await sut.request({url: 'https://example.com/a'});

    expect(result).toEqual({outcome: 'unavailable'});
    expect(deletes.deleteIfQueued).toHaveBeenCalledWith('audit-1');
  });

  it('keeps the audit when the queue turns out to have accepted it', async () => {
    const {sut, queue, deletes} = makeSut();
    queue.enqueueOnce.mockRejectedValue(new Error('ECONNREFUSED'));
    queue.has.mockResolvedValue(true);

    const result = await sut.request({url: 'https://example.com/a'});

    expect(result.outcome).toBe('queued');
    expect(deletes.deleteIfQueued).not.toHaveBeenCalled();
  });

  it('retries the same audit rather than submitting a second one', async () => {
    const {sut, queue} = makeSut();
    queue.enqueueOnce.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await sut.request({url: 'https://example.com/a'});

    expect(queue.enqueueOnce.mock.calls).toEqual([[{auditId: 'audit-1'}], [{auditId: 'audit-1'}]]);
  });

  it('deletes the row when the queue cannot say whether it accepted', async () => {
    const {sut, queue, deletes} = makeSut();
    queue.enqueueOnce.mockRejectedValue(new Error('ECONNREFUSED'));
    queue.has.mockRejectedValue(new Error('ECONNREFUSED'));

    expect((await sut.request({url: 'https://example.com/a'})).outcome).toBe('unavailable');
    expect(deletes.deleteIfQueued).toHaveBeenCalledWith('audit-1');
  });

  it('does not hang when the queue never answers', async () => {
    const {sut, queue, deletes} = makeSut();
    queue.enqueueOnce.mockImplementation(async () => await new Promise<never>(() => {}));
    queue.has.mockImplementation(async () => await new Promise<never>(() => {}));

    const result = await sut.request({url: 'https://example.com/a'});

    expect(result).toEqual({outcome: 'unavailable'});
    expect(deletes.deleteIfQueued).toHaveBeenCalledWith('audit-1');
  }, 30_000);

  it('still reports unavailable when the cleanup delete also fails', async () => {
    const {sut, queue, deletes} = makeSut();
    queue.enqueueOnce.mockRejectedValue(new Error('ECONNREFUSED'));
    deletes.deleteIfQueued.mockRejectedValue(new Error('database down'));

    expect(await sut.request({url: 'https://example.com/a'})).toEqual({outcome: 'unavailable'});
  });

  it('lets a database failure escape, rather than reporting unavailable', async () => {
    const {sut, audits} = makeSut();
    audits.add.mockRejectedValueOnce(new Error('database down'));

    await expect(sut.request({url: 'https://example.com/a'})).rejects.toThrow('database down');
  });
});
