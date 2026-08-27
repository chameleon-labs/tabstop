import {describe, expect, it} from 'vitest';
import {DbRunScheduledReaudits} from './db-run-scheduled-reaudits.js';
import {reauditDelayMs} from '../../../domain/services/reaudit-schedule.js';
import {ENQUEUE_TIMEOUT_MS} from '../../helpers/audit-submission.js';
import {
  mockAddScheduledAuditRepository,
  mockAuditQueue,
  mockDeleteQueuedAuditRepository,
  mockAuditModel,
  mockLoadDueReauditsRepository,
  mockPagedDueReauditsRepository,
  mockPagedStaleAudits,
  mockStaleAudit,
} from '../../test/index.js';
import type {DuePage} from '../../protocols/db/page/load-due-reaudits-repository.js';

const BATCH = 100;
const MAX_PAGES = 500;
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;
const NOW = new Date('2026-08-01T02:00:00Z');

const makeSut = (limits: {batchSize?: number; maxPagesPerRun?: number} = {}) => {
  const pages = mockLoadDueReauditsRepository();
  const audits = mockAddScheduledAuditRepository();
  const deletes = mockDeleteQueuedAuditRepository();
  const queue = mockAuditQueue();
  const sut = new DbRunScheduledReaudits(
    pages,
    audits,
    deletes,
    queue,
    limits.batchSize ?? BATCH,
    limits.maxPagesPerRun ?? MAX_PAGES,
    STALE_AFTER_MS,
  );
  return {sut, pages, audits, deletes, queue};
};

const pagesOn = (domain: string, count: number): DuePage[] =>
  Array.from({length: count}, (_value, index) => ({
    pageId: `page-${String(index).padStart(4, '0')}`,
    url: `https://${domain}/${index}`,
    domain,
  }));

describe('DbRunScheduledReaudits', () => {
  it('creates one audit per due page and queues each one', async () => {
    const {sut, audits, queue} = makeSut();

    const summary = await sut.run(NOW);

    expect(audits.addScheduled.mock.calls.map(([params]) => params)).toEqual([
      {pageId: 'page-1', url: 'https://example.test/a', scheduledFor: '2026-08-01'},
      {pageId: 'page-2', url: 'https://other.test/b', scheduledFor: '2026-08-01'},
    ]);
    expect(queue.enqueueOnce).toHaveBeenCalledTimes(2);
    expect(summary).toEqual({
      scheduledFor: '2026-08-01',
      pagesConsidered: 2,
      auditsEnqueued: 2,
      skippedDuplicate: 0,
      failed: 0,
      abandonedReclaimed: 0,
      reclaimFailures: 0,
      truncated: false,
    });
  });

  it('asks for pages due since midnight UTC of the run day', async () => {
    const {sut, pages} = makeSut();

    await sut.run(new Date('2026-08-01T23:30:00Z'));

    expect(pages.loadDueForReaudit).toHaveBeenCalledWith(
      expect.objectContaining({dayStart: new Date('2026-08-01T00:00:00.000Z')}),
    );
  });

  it('looks for abandoned audits older than the stale cutoff', async () => {
    const {sut, audits} = makeSut();

    await sut.run(NOW);

    expect(audits.loadStaleInFlight).toHaveBeenCalledWith(new Date(NOW.getTime() - STALE_AFTER_MS), BATCH, null);
  });

  it('asks for one row more than it means to use', async () => {
    const {sut, pages} = makeSut({batchSize: 100});

    await sut.run(NOW);

    expect(pages.loadDueForReaudit).toHaveBeenCalledWith(expect.objectContaining({limit: 101, after: null}));
  });

  it('stamps every row of one run with the same day, even across midnight', async () => {
    const {sut, audits} = makeSut();

    await sut.run(new Date('2026-08-01T23:59:59.999Z'));

    const days = audits.addScheduled.mock.calls.map(([params]) => params.scheduledFor);
    expect(new Set(days)).toEqual(new Set(['2026-08-01']));
  });

  it('gives each page the delay its own identity earns it', async () => {
    const {sut, pages, queue} = makeSut();
    const due = pagesOn('example.test', 3);
    pages.loadDueForReaudit.mockResolvedValueOnce(due);

    await sut.run(NOW);

    expect(queue.enqueueOnce.mock.calls.map(([, options]) => options?.delayMs)).toEqual(
      due.map((page) => reauditDelayMs(page.domain, page.pageId)),
    );
  });

  it('gives a page the same delay wherever it lands in the worklist', async () => {
    const {sut, pages, queue} = makeSut();
    const [first, second, third] = pagesOn('example.test', 3);
    if (first === undefined || second === undefined || third === undefined) {
      return;
    }

    pages.loadDueForReaudit.mockResolvedValueOnce([first, second, third]);
    await sut.run(NOW);
    const wholeRun = queue.enqueueOnce.mock.calls.map(([, options]) => options?.delayMs);

    queue.enqueueOnce.mockClear();
    pages.loadDueForReaudit.mockReset();
    pages.loadDueForReaudit.mockResolvedValueOnce([third]);
    await sut.run(NOW);
    const retry = queue.enqueueOnce.mock.calls.map(([, options]) => options?.delayMs);

    expect(retry).toEqual([wholeRun[2]]);
  });

  it('treats a page another run already scheduled as skipped, not failed', async () => {
    const {sut, audits, queue, deletes} = makeSut();
    audits.addScheduled.mockResolvedValueOnce(null);

    const summary = await sut.run(NOW);

    expect(summary.skippedDuplicate).toBe(1);
    expect(summary.auditsEnqueued).toBe(1);
    expect(summary.failed).toBe(0);
    expect(queue.enqueueOnce).toHaveBeenCalledTimes(1);
    expect(deletes.deleteIfQueued).not.toHaveBeenCalled();
  });

  it('removes the audit row when the queue genuinely refuses the job', async () => {
    const {sut, queue, deletes} = makeSut();
    queue.enqueueOnce.mockRejectedValue(new Error('redis is down'));

    const summary = await sut.run(NOW);

    expect(deletes.deleteIfQueued.mock.calls.map(([id]) => id)).toEqual(['audit-for-page-1', 'audit-for-page-2']);
    expect(summary).toMatchObject({auditsEnqueued: 0, failed: 2});
  });

  it('keeps the row when the queue may have taken the job but lost the reply', async () => {
    const {sut, queue, deletes} = makeSut();
    queue.enqueueOnce.mockRejectedValue(new Error('timeout'));
    queue.has.mockResolvedValue(true);

    const summary = await sut.run(NOW);

    expect(deletes.deleteIfQueued).not.toHaveBeenCalled();
    expect(summary.auditsEnqueued).toBe(2);
  });

  it('keeps going when one page cannot be inserted', async () => {
    const {sut, audits, queue} = makeSut();
    audits.addScheduled.mockRejectedValueOnce(new Error('deadlock detected'));

    const summary = await sut.run(NOW);

    expect(summary).toMatchObject({failed: 1, auditsEnqueued: 1});
    expect(queue.enqueueOnce).toHaveBeenCalledTimes(1);
  });

  it('keeps paging until every due page is scheduled', async () => {
    const pages = mockPagedDueReauditsRepository(pagesOn('example.test', 250));
    const audits = mockAddScheduledAuditRepository();
    const sut = new DbRunScheduledReaudits(
      pages,
      audits,
      mockDeleteQueuedAuditRepository(),
      mockAuditQueue(),
      100,
      MAX_PAGES,
      STALE_AFTER_MS,
    );

    const summary = await sut.run(NOW);

    expect(summary.pagesConsidered).toBe(250);
    expect(audits.addScheduled).toHaveBeenCalledTimes(250);
    expect(summary.truncated).toBe(false);
  });

  it('advances the cursor past the last page of each batch', async () => {
    const all = pagesOn('example.test', 250);
    const pages = mockPagedDueReauditsRepository(all);
    const sut = new DbRunScheduledReaudits(
      pages,
      mockAddScheduledAuditRepository(),
      mockDeleteQueuedAuditRepository(),
      mockAuditQueue(),
      100,
      MAX_PAGES,
      STALE_AFTER_MS,
    );

    await sut.run(NOW);

    expect(pages.loadDueForReaudit.mock.calls.map(([query]) => query.after)).toEqual([null, 'page-0099', 'page-0199']);
  });

  it('does not call a full final batch truncated', async () => {
    const all = pagesOn('example.test', 100);
    const pages = mockPagedDueReauditsRepository(all);
    const sut = new DbRunScheduledReaudits(
      pages,
      mockAddScheduledAuditRepository(),
      mockDeleteQueuedAuditRepository(),
      mockAuditQueue(),
      100,
      MAX_PAGES,
      STALE_AFTER_MS,
    );

    const summary = await sut.run(NOW);

    expect(summary.pagesConsidered).toBe(100);
    expect(summary.truncated).toBe(false);
  });

  it('reports a run its circuit breaker cut short', async () => {
    const all = pagesOn('example.test', 250);
    const pages = mockPagedDueReauditsRepository(all);
    const sut = new DbRunScheduledReaudits(
      pages,
      mockAddScheduledAuditRepository(),
      mockDeleteQueuedAuditRepository(),
      mockAuditQueue(),
      100,
      200,
      STALE_AFTER_MS,
    );

    const summary = await sut.run(NOW);

    expect(summary.pagesConsidered).toBe(200);
    expect(summary.truncated).toBe(true);
  });

  it("gives one domain's pages the same delays across a batch boundary as within one", async () => {
    const all = pagesOn('example.test', 4);
    const queue = mockAuditQueue();
    const sut = new DbRunScheduledReaudits(
      mockPagedDueReauditsRepository(all),
      mockAddScheduledAuditRepository(),
      mockDeleteQueuedAuditRepository(),
      queue,
      2,
      MAX_PAGES,
      STALE_AFTER_MS,
    );

    await sut.run(NOW);

    expect(queue.enqueueOnce.mock.calls.map(([, options]) => options?.delayMs)).toEqual(
      all.map((page) => reauditDelayMs(page.domain, page.pageId)),
    );
  });

  describe('reclaiming abandoned audits', () => {
    it('retires an old unfinished audit whose job the queue no longer holds', async () => {
      const {sut, audits, queue} = makeSut();
      audits.loadStaleInFlight.mockResolvedValueOnce([mockStaleAudit('audit-7', 1)]);
      queue.isPending.mockResolvedValue(false);

      const summary = await sut.run(NOW);

      expect(audits.markAbandoned).toHaveBeenCalledWith('audit-7', expect.any(String));
      expect(summary.abandonedReclaimed).toBe(1);
    });

    it('leaves an old audit alone while its job still exists', async () => {
      const {sut, audits, queue} = makeSut();
      audits.loadStaleInFlight.mockResolvedValueOnce([mockStaleAudit('audit-7', 1)]);
      queue.isPending.mockResolvedValue(true);

      const summary = await sut.run(NOW);

      expect(audits.markAbandoned).not.toHaveBeenCalled();
      expect(summary.abandonedReclaimed).toBe(0);
    });

    it('leaves an old audit alone when the queue never answers', async () => {
      const {sut, audits, queue} = makeSut();
      audits.loadStaleInFlight.mockResolvedValueOnce([mockStaleAudit('audit-7', 1)]);
      queue.isPending.mockImplementation(async () => await new Promise<never>(() => {}));

      const startedAt = Date.now();
      const summary = await sut.run(NOW);

      expect(audits.markAbandoned).not.toHaveBeenCalled();
      expect(summary.abandonedReclaimed).toBe(0);
      expect(summary.auditsEnqueued).toBe(2);
      expect(Date.now() - startedAt).toBeLessThan(ENQUEUE_TIMEOUT_MS * 3);
    });

    it('leaves an old audit alone when the queue cannot answer at all', async () => {
      const {sut, audits, queue} = makeSut();
      audits.loadStaleInFlight.mockResolvedValueOnce([mockStaleAudit('audit-7', 1)]);
      queue.isPending.mockRejectedValue(new Error('redis is down'));

      const summary = await sut.run(NOW);

      expect(audits.markAbandoned).not.toHaveBeenCalled();
      expect(summary.abandonedReclaimed).toBe(0);
      expect(summary.reclaimFailures).toBe(1);
    });

    it('reclaims before building the worklist, so a freed page is scheduled tonight', async () => {
      const {sut, audits, pages, queue} = makeSut();
      audits.loadStaleInFlight.mockResolvedValueOnce([mockStaleAudit('audit-7', 1)]);
      queue.isPending.mockResolvedValue(false);

      await sut.run(NOW);

      expect(audits.markAbandoned.mock.invocationCallOrder[0] as number).toBeLessThan(
        pages.loadDueForReaudit.mock.invocationCallOrder[0] as number,
      );
    });

    it('does not count a row another run had already retired', async () => {
      const {sut, audits, queue} = makeSut();
      audits.loadStaleInFlight.mockResolvedValueOnce([mockStaleAudit('audit-7', 1)]);
      queue.isPending.mockResolvedValue(false);
      audits.markAbandoned.mockResolvedValueOnce(false);

      expect((await sut.run(NOW)).abandonedReclaimed).toBe(0);
    });

    it('still runs the night when reclaiming cannot even start', async () => {
      const {sut, audits} = makeSut();
      audits.loadStaleInFlight.mockRejectedValueOnce(new Error('the database is down'));

      const summary = await sut.run(NOW);

      expect(summary.abandonedReclaimed).toBe(0);
      expect(summary.auditsEnqueued).toBe(2);
    });

    it('counts a candidate it could not check, rather than calling it a quiet night', async () => {
      const {sut, audits, queue} = makeSut();
      audits.loadStaleInFlight.mockResolvedValueOnce([mockStaleAudit('audit-7', 1), mockStaleAudit('audit-8', 2)]);
      queue.isPending.mockRejectedValue(new Error('redis is down'));

      const summary = await sut.run(NOW);

      expect(audits.markAbandoned).not.toHaveBeenCalled();
      expect(summary).toMatchObject({abandonedReclaimed: 0, reclaimFailures: 2});
    });

    it('reports a failure to look rather than passing it off as nothing to do', async () => {
      const {sut, audits} = makeSut();
      audits.loadStaleInFlight.mockRejectedValueOnce(new Error('the database is down'));

      expect((await sut.run(NOW)).reclaimFailures).toBe(1);
    });

    it('counts a row it identified but could not retire', async () => {
      const {sut, audits, queue} = makeSut();
      audits.loadStaleInFlight.mockResolvedValueOnce([mockStaleAudit('audit-7', 1), mockStaleAudit('audit-8', 2)]);
      queue.isPending.mockResolvedValue(false);
      audits.markAbandoned.mockRejectedValueOnce(new Error('deadlock detected'));

      const summary = await sut.run(NOW);

      expect(summary).toMatchObject({abandonedReclaimed: 1, reclaimFailures: 1});
    });

    it('reports no failures on a night with nothing to reclaim', async () => {
      expect((await makeSut().sut.run(NOW)).reclaimFailures).toBe(0);
    });

    it('reaches an orphan sitting behind a batch of pending candidates', async () => {
      const pending = Array.from({length: 5}, (_v, i) => mockStaleAudit(`pending-${i}`, i));
      const orphan = mockStaleAudit('orphan', 99);
      const {sut, audits, queue} = makeSut({batchSize: 5});
      audits.loadStaleInFlight.mockImplementation(mockPagedStaleAudits([...pending, orphan]));
      queue.isPending.mockImplementation((auditId) => Promise.resolve(auditId !== 'orphan'));

      const summary = await sut.run(NOW);

      expect(audits.markAbandoned).toHaveBeenCalledWith('orphan', expect.any(String));
      expect(summary.abandonedReclaimed).toBe(1);
    });

    it('carries the cursor forward rather than reloading the same batch', async () => {
      const pending = Array.from({length: 4}, (_v, i) => mockStaleAudit(`pending-${i}`, i));
      const {sut, audits, queue} = makeSut({batchSize: 2});
      audits.loadStaleInFlight.mockImplementation(mockPagedStaleAudits(pending));
      queue.isPending.mockResolvedValue(true);

      await sut.run(NOW);

      expect(audits.loadStaleInFlight.mock.calls.map(([, , after]) => after?.auditId ?? null)).toEqual([
        null,
        'pending-1',
        'pending-3',
      ]);
    });

    it("stops examining candidates at the run's ceiling", async () => {
      const many = Array.from({length: 50}, (_v, i) => mockStaleAudit(`stale-${i}`, i));
      const {sut, audits, queue} = makeSut({batchSize: 5, maxPagesPerRun: 10});
      audits.loadStaleInFlight.mockImplementation(mockPagedStaleAudits(many));
      queue.isPending.mockResolvedValue(true);

      await sut.run(NOW);

      expect(queue.isPending).toHaveBeenCalledTimes(10);
    });
  });

  describe('reporting progress', () => {
    it('hands out counters as it goes, not only at the end', async () => {
      const pages = mockPagedDueReauditsRepository(pagesOn('example.test', 250));
      const seen: number[] = [];
      const sut = new DbRunScheduledReaudits(
        pages,
        mockAddScheduledAuditRepository(),
        mockDeleteQueuedAuditRepository(),
        mockAuditQueue(),
        100,
        MAX_PAGES,
        STALE_AFTER_MS,
      );

      await sut.run(NOW, {report: (summary) => seen.push(summary.pagesConsidered)});

      expect(seen).toEqual([0, 100, 200, 250]);
    });

    it('leaves the caller holding real counters when the run throws', async () => {
      const pages = mockPagedDueReauditsRepository(pagesOn('example.test', 250));
      pages.loadDueForReaudit.mockImplementationOnce(
        async (query) => await Promise.resolve(pagesOn('example.test', 250).slice(0, query.limit)),
      );
      pages.loadDueForReaudit.mockRejectedValueOnce(new Error('the database went away'));
      let latest: {pagesConsidered: number} | null = null;
      const sut = new DbRunScheduledReaudits(
        pages,
        mockAddScheduledAuditRepository(),
        mockDeleteQueuedAuditRepository(),
        mockAuditQueue(),
        100,
        MAX_PAGES,
        STALE_AFTER_MS,
      );

      await expect(
        sut.run(NOW, {
          report: (summary) => {
            latest = summary;
          },
        }),
      ).rejects.toThrow('the database went away');

      expect(latest).toMatchObject({pagesConsidered: 100});
    });

    it('reports a copy, so the caller is not holding a moving target', async () => {
      const pages = mockPagedDueReauditsRepository(pagesOn('example.test', 250));
      const snapshots: {pagesConsidered: number}[] = [];
      const sut = new DbRunScheduledReaudits(
        pages,
        mockAddScheduledAuditRepository(),
        mockDeleteQueuedAuditRepository(),
        mockAuditQueue(),
        100,
        MAX_PAGES,
        STALE_AFTER_MS,
      );

      await sut.run(NOW, {report: (summary) => snapshots.push(summary)});

      expect(snapshots.map((snapshot) => snapshot.pagesConsidered)).toEqual([0, 100, 200, 250]);
    });
  });

  describe('shutting down mid-run', () => {
    it('stops at the next page rather than running to completion', async () => {
      const pages = mockPagedDueReauditsRepository(pagesOn('example.test', 50));
      const audits = mockAddScheduledAuditRepository();
      const controller = new AbortController();
      audits.addScheduled.mockImplementation((params) => {
        controller.abort();
        return Promise.resolve({...mockAuditModel(), id: `audit-for-${params.pageId}`, pageId: params.pageId});
      });
      const sut = new DbRunScheduledReaudits(
        pages,
        audits,
        mockDeleteQueuedAuditRepository(),
        mockAuditQueue(),
        10,
        MAX_PAGES,
        STALE_AFTER_MS,
      );

      const summary = await sut.run(NOW, {signal: controller.signal});

      expect(summary.pagesConsidered).toBe(1);
      expect(summary.truncated).toBe(true);
    });

    it('does not start at all when it is already too late', async () => {
      const pages = mockPagedDueReauditsRepository(pagesOn('example.test', 50));
      const audits = mockAddScheduledAuditRepository();
      const sut = new DbRunScheduledReaudits(
        pages,
        audits,
        mockDeleteQueuedAuditRepository(),
        mockAuditQueue(),
        10,
        MAX_PAGES,
        STALE_AFTER_MS,
      );

      const summary = await sut.run(NOW, {signal: AbortSignal.abort()});

      expect(pages.loadDueForReaudit).not.toHaveBeenCalled();
      expect(summary).toMatchObject({pagesConsidered: 0, truncated: true});
    });
  });

  it('counts a page whose cleanup also failed, and moves on', async () => {
    const {sut, queue, deletes} = makeSut();
    queue.enqueueOnce.mockRejectedValue(new Error('redis is down'));
    deletes.deleteIfQueued.mockRejectedValue(new Error('the database is down too'));

    const summary = await sut.run(NOW);

    expect(summary).toMatchObject({failed: 2, auditsEnqueued: 0});
  });

  it('reports a night with nothing to do rather than staying silent', async () => {
    const {sut, pages, queue} = makeSut();
    pages.loadDueForReaudit.mockResolvedValueOnce([]);

    const summary = await sut.run(NOW);

    expect(queue.enqueueOnce).not.toHaveBeenCalled();
    expect(summary).toEqual({
      scheduledFor: '2026-08-01',
      pagesConsidered: 0,
      auditsEnqueued: 0,
      skippedDuplicate: 0,
      failed: 0,
      abandonedReclaimed: 0,
      reclaimFailures: 0,
      truncated: false,
    });
  });

  it('creates the audit row before handing the job to the queue', async () => {
    const {sut, audits, queue} = makeSut();

    await sut.run(NOW);

    expect(audits.addScheduled.mock.invocationCallOrder[0] as number).toBeLessThan(
      queue.enqueueOnce.mock.invocationCallOrder[0] as number,
    );
  });
});
