import {describe, expect, it, vi} from 'vitest';
import {DbRequestPageAudit} from './db-request-page-audit.js';
import {mockAddOnDemandAuditRepository, mockAuditQueue, mockDeleteQueuedAuditRepository} from '../../test/index.js';
import type {AuditJobQueue} from '../../protocols/queue/audit-job-queue.js';

const AT = new Date('2026-08-18T14:30:00.000Z');

const makeSut = (now: Date = AT, allowance = 1, maxDepth = 100) => {
  const audits = mockAddOnDemandAuditRepository();
  const deletes = mockDeleteQueuedAuditRepository();
  const queue = mockAuditQueue();
  const sut = new DbRequestPageAudit(audits, deletes, queue, maxDepth, allowance, () => now);
  return {sut, audits, deletes, queue};
};

describe('DbRequestPageAudit', () => {
  it('queues an audit attached to the page, so it lands in that page trend', async () => {
    const {sut, audits, queue} = makeSut();

    const result = await sut.request({userId: '7', pageId: '42'});

    expect(result).toMatchObject({outcome: 'queued'});
    expect(audits.addOnDemand).toHaveBeenCalledWith(expect.objectContaining({userId: '7', pageId: '42'}));
    expect(queue.enqueueOnce).toHaveBeenCalledOnce();
  });

  it('counts the allowance from the start of the UTC day, not the last 24 hours', async () => {
    // A rolling window would let an audit taken at 23:00 block the next
    // morning, which is not what "one a day" means to a reader looking at a
    // date. It also has to agree with the nightly run, whose whole dedupe is
    // in UTC days.
    const {sut, audits} = makeSut();

    await sut.request({userId: '7', pageId: '42'});

    expect(audits.addOnDemand).toHaveBeenCalledWith(
      expect.objectContaining({since: new Date('2026-08-18T00:00:00.000Z'), allowance: 1}),
    );
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
    // The order this pins is the whole point of checking depth first. A reader
    // told to come back later has to still have something to come back with,
    // so a refusal must not write the row that costs them their day.
    const {sut, audits, queue} = makeSut();
    queue.backlogCount = vi.fn<AuditJobQueue['backlogCount']>(() => Promise.resolve(100));

    expect(await sut.request({userId: '7', pageId: '42'})).toEqual({outcome: 'unavailable'});
    expect(audits.addOnDemand).not.toHaveBeenCalled();
  });

  it('gives the allowance back when the queue genuinely refused the job', async () => {
    // The row is removed, so the count that decides tomorrow's allowance does
    // not include an audit nothing will ever run.
    const {sut, deletes, queue} = makeSut();
    queue.enqueueOnce = vi.fn<AuditJobQueue['enqueueOnce']>(() => Promise.reject(new Error('redis down')));
    queue.has = vi.fn<AuditJobQueue['has']>(() => Promise.resolve(false));

    expect(await sut.request({userId: '7', pageId: '42'})).toEqual({outcome: 'unavailable'});
    expect(deletes.deleteIfQueued).toHaveBeenCalledWith('audit-for-42');
  });

  it('keeps the row when the queue may have taken the job and lost the reply', async () => {
    // Deleting it then would leave a job pointing at an audit that no longer
    // exists - the reasoning `DbRequestAudit` records, and the reason this
    // path is not simply "enqueue failed".
    const {sut, deletes, queue} = makeSut();
    queue.enqueueOnce = vi.fn<AuditJobQueue['enqueueOnce']>(() => Promise.reject(new Error('timeout')));
    queue.has = vi.fn<AuditJobQueue['has']>(() => Promise.resolve(true));

    expect(await sut.request({userId: '7', pageId: '42'})).toMatchObject({outcome: 'queued'});
    expect(deletes.deleteIfQueued).not.toHaveBeenCalled();
  });
});
