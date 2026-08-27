import {describe, expect, it, vi} from 'vitest';
import {DbRequestPageAudit} from './db-request-page-audit.js';
import {mockAddOnDemandAuditRepository, mockAuditQueue, mockReleaseOnDemandAuditRepository} from '../../test/index.js';
import type {AuditJobQueue} from '../../protocols/queue/audit-job-queue.js';

const AT = new Date('2026-08-18T14:30:00.000Z');

const makeSut = (now: Date = AT, allowance = 1, maxDepth = 100) => {
  const audits = mockAddOnDemandAuditRepository();
  const releases = mockReleaseOnDemandAuditRepository();
  const queue = mockAuditQueue();
  const sut = new DbRequestPageAudit(audits, releases, queue, maxDepth, allowance, () => now);
  return {sut, audits, releases, queue};
};

describe('DbRequestPageAudit', () => {
  it('queues an audit attached to the page, so it lands in that page trend', async () => {
    const {sut, audits, queue} = makeSut();

    const result = await sut.request({userId: '7', pageId: '42'});

    expect(result).toMatchObject({outcome: 'queued'});
    expect(audits.addOnDemand).toHaveBeenCalledWith(expect.objectContaining({userId: '7', pageId: '42'}));
    expect(queue.enqueueOnce).toHaveBeenCalledOnce();
  });

  it('counts the allowance in UTC calendar days, not over the last 24 hours', async () => {
    const {sut, audits} = makeSut();

    await sut.request({userId: '7', pageId: '42'});

    expect(audits.addOnDemand).toHaveBeenCalledWith(expect.objectContaining({day: '2026-08-18', allowance: 1}));
  });

  it('says when a spent allowance refills, which is the next UTC midnight', async () => {
    const {sut, audits} = makeSut();
    audits.addOnDemand.mockResolvedValueOnce({outcome: 'allowance-spent'});

    const result = await sut.request({userId: '7', pageId: '42'});

    expect(result).toEqual({outcome: 'allowance-spent', resetAt: new Date('2026-08-19T00:00:00.000Z')});
  });

  it('reports a page it will not name, without enqueueing anything', async () => {
    const {sut, queue, audits} = makeSut();
    audits.addOnDemand.mockResolvedValueOnce({outcome: 'not-found'});

    expect(await sut.request({userId: '7', pageId: '42'})).toEqual({outcome: 'not-found'});
    expect(queue.enqueueOnce).not.toHaveBeenCalled();
  });

  it('refuses a page that is already being audited', async () => {
    const {sut, queue, audits} = makeSut();
    audits.addOnDemand.mockResolvedValueOnce({outcome: 'in-flight'});

    expect(await sut.request({userId: '7', pageId: '42'})).toEqual({outcome: 'in-flight'});
    expect(queue.enqueueOnce).not.toHaveBeenCalled();
  });

  it('refuses a full queue WITHOUT spending the day allowance', async () => {
    const {sut, audits, queue} = makeSut();
    queue.backlogCount = vi.fn<AuditJobQueue['backlogCount']>(() => Promise.resolve(100));

    expect(await sut.request({userId: '7', pageId: '42'})).toEqual({outcome: 'unavailable'});
    expect(audits.addOnDemand).not.toHaveBeenCalled();
  });

  it('gives the allowance back when the queue genuinely refused the job', async () => {
    const {sut, releases, queue} = makeSut();
    queue.enqueueOnce = vi.fn<AuditJobQueue['enqueueOnce']>(() => Promise.reject(new Error('redis down')));
    queue.has = vi.fn<AuditJobQueue['has']>(() => Promise.resolve(false));

    expect(await sut.request({userId: '7', pageId: '42'})).toEqual({outcome: 'unavailable'});
    expect(releases.releaseOnDemand).toHaveBeenCalledWith('audit-for-42');
  });

  it('keeps the row when the queue may have taken the job and lost the reply', async () => {
    const {sut, releases, queue} = makeSut();
    queue.enqueueOnce = vi.fn<AuditJobQueue['enqueueOnce']>(() => Promise.reject(new Error('timeout')));
    queue.has = vi.fn<AuditJobQueue['has']>(() => Promise.resolve(true));

    expect(await sut.request({userId: '7', pageId: '42'})).toMatchObject({outcome: 'queued'});
    expect(releases.releaseOnDemand).not.toHaveBeenCalled();
  });
});
