import {afterEach, describe, expect, it, vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {makeQueue, makeWorker} from './helpers/bullmq-helper.js';
import {BullMqAuditQueue, BullMqJobQueue} from './bullmq-job-queue.js';
import type {PayloadQueue, PayloadWorker} from './helpers/bullmq-helper.js';
import type {AuditJob} from '../../data/protocols/queue/audit-job-queue.js';

type TestPayload = {value: string};

const connectionUrl = (): string => {
  const url = process.env.REDIS_URL;
  if (url === undefined) {
    throw new Error('REDIS_URL not set by globalSetup');
  }
  return url;
};

describe('BullMqJobQueue', () => {
  let queue: PayloadQueue<TestPayload> | null = null;
  let worker: PayloadWorker<TestPayload> | null = null;

  afterEach(async () => {
    try {
      await worker?.close();
    } finally {
      await queue?.close();
      worker = null;
      queue = null;
    }
  });

  it('round-trips a payload from enqueue to a consumer', async () => {
    const name = `test-${randomUUID()}`;
    const received: TestPayload[] = [];

    queue = makeQueue<TestPayload>(name, connectionUrl());
    worker = makeWorker<TestPayload>(name, connectionUrl(), (job) => {
      received.push(job.data);
      return Promise.resolve();
    });
    await worker.waitUntilReady();

    const sut = new BullMqJobQueue(queue);
    await sut.enqueue({value: 'hello'});

    await vi.waitFor(
      () => {
        expect(received).toEqual([{value: 'hello'}]);
      },
      {timeout: 10_000},
    );
  });

  it('retries a failing handler and succeeds on a later attempt', async () => {
    const name = `test-${randomUUID()}`;
    let attempts = 0;

    queue = makeQueue<TestPayload>(name, connectionUrl());
    worker = makeWorker<TestPayload>(name, connectionUrl(), () => {
      attempts += 1;
      if (attempts < 3) {
        return Promise.reject(new Error('transient'));
      }
      return Promise.resolve();
    });
    await worker.waitUntilReady();

    const job = await queue.add(name, {value: 'retry me'}, {attempts: 3, backoff: {type: 'fixed', delay: 10}});

    const jobId = job.id;
    if (jobId === undefined) {
      throw new Error('BullMQ did not assign a job id');
    }

    await vi.waitFor(
      async () => {
        const stored = await queue?.getJob(jobId);
        expect(stored?.attemptsMade).toBe(3);
        expect(await stored?.getState()).toBe('completed');
      },
      {timeout: 10_000},
    );
  });

  it('lands a job in the failed state once its attempts are exhausted', async () => {
    const name = `test-${randomUUID()}`;
    let attempts = 0;

    queue = makeQueue<TestPayload>(name, connectionUrl());
    worker = makeWorker<TestPayload>(name, connectionUrl(), () => {
      attempts += 1;
      return Promise.reject(new Error('permanent'));
    });
    await worker.waitUntilReady();

    const job = await queue.add(name, {value: 'always fails'}, {attempts: 3, backoff: {type: 'fixed', delay: 10}});

    const jobId = job.id;
    if (jobId === undefined) {
      throw new Error('BullMQ did not assign a job id');
    }

    await vi.waitFor(
      async () => {
        const stored = await queue?.getJob(jobId);
        expect(await stored?.getState()).toBe('failed');
        expect(stored?.attemptsMade).toBe(3);
        expect(stored?.failedReason).toBe('permanent');
      },
      {timeout: 10_000},
    );

    expect(attempts).toBe(3);
  });

  it('applies the shared default job options', () => {
    const name = `test-${randomUUID()}`;
    queue = makeQueue<TestPayload>(name, connectionUrl());

    expect(queue.jobsOpts).toMatchObject({
      attempts: 3,
      backoff: {type: 'exponential', delay: 1000},
    });
  });
});

describe('BullMqAuditQueue', () => {
  let queue: PayloadQueue<AuditJob> | null = null;
  let worker: PayloadWorker<AuditJob> | null = null;

  afterEach(async () => {
    try {
      await worker?.close();
    } finally {
      await queue?.close();
      worker = null;
      queue = null;
    }
  });

  const auditId = '12345';

  it('enqueues an audit whose id is all digits', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    await sut.enqueueOnce({auditId});

    const jobs = await queue.getJobs(['waiting', 'prioritized', 'delayed', 'active']);
    expect(jobs.map((job) => job.data)).toEqual([{auditId}]);
  });

  it('enqueues one job when the same audit is submitted twice', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    await sut.enqueueOnce({auditId});
    await sut.enqueueOnce({auditId});

    expect(await queue.getJobCountByTypes('waiting', 'prioritized', 'delayed', 'active')).toBe(1);
  });

  it('finds a job it enqueued, and reports an unknown audit as absent', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    await sut.enqueueOnce({auditId});

    expect(await sut.has(auditId)).toBe(true);
    expect(await sut.has('67890')).toBe(false);
  });

  it('counts the jobs that are runnable now, and not the ones scheduled for later', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    expect(await sut.backlogCount()).toBe(0);

    await sut.enqueueOnce({auditId: '111'});
    await sut.enqueueOnce({auditId: '222'});
    expect(await sut.backlogCount()).toBe(2);

    await sut.enqueueOnce({auditId: '333'}, {delayMs: 60_000});
    expect(await queue.getJobCountByTypes('delayed')).toBe(1);
    expect(await sut.backlogCount()).toBe(2);

    await sut.enqueueOnce({auditId: '111'});
    expect(await sut.backlogCount()).toBe(2);
  });

  it('counts a scheduled job once its delay has elapsed', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    worker = makeWorker<AuditJob>(name, connectionUrl(), async () => {
      await gate;
    });
    await worker.waitUntilReady();

    try {
      await sut.enqueueOnce({auditId: '777'}, {delayMs: 500});
      await sut.enqueueOnce({auditId: '778'}, {delayMs: 500});
      expect(await sut.backlogCount()).toBe(0);

      await vi.waitFor(
        async () => {
          expect(await sut.backlogCount()).toBeGreaterThanOrEqual(1);
        },
        {timeout: 20_000},
      );
    } finally {
      release();
    }
  });

  it('does not count a job inside its retry backoff, which is the cost of the rule above', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    worker = makeWorker<AuditJob>(name, connectionUrl(), () => Promise.reject(new Error('transient')));
    await worker.waitUntilReady();
    const sut = new BullMqAuditQueue(queue);

    await queue.add(
      name,
      {auditId: '999'},
      {
        jobId: 'audit-999',
        attempts: 2,
        backoff: {type: 'fixed', delay: 5_000},
      },
    );

    await vi.waitFor(
      async () => {
        expect(await queue?.getJobCountByTypes('delayed')).toBe(1);
      },
      {timeout: 10_000},
    );

    expect(await sut.backlogCount()).toBe(0);
  });

  it('hands the delay to BullMQ rather than sleeping on it', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    const before = Date.now();
    await sut.enqueueOnce({auditId}, {delayMs: 3_600_000});
    const elapsed = Date.now() - before;

    const job = await queue.getJob(`audit-${auditId}`);
    expect(job?.opts.delay).toBe(3_600_000);
    expect(await job?.getState()).toBe('delayed');
    expect(elapsed).toBeLessThan(5_000);
  });

  it('reports a job that has finished as no longer pending, though it still exists', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    worker = makeWorker<AuditJob>(name, connectionUrl(), () => Promise.reject(new Error('permanent')));
    await worker.waitUntilReady();
    const sut = new BullMqAuditQueue(queue);

    await queue.add(name, {auditId}, {jobId: `audit-${auditId}`, attempts: 1});

    await vi.waitFor(
      async () => {
        expect(await queue?.getJobCountByTypes('failed')).toBe(1);
      },
      {timeout: 10_000},
    );

    expect(await sut.has(auditId)).toBe(true);
    expect(await sut.isPending(auditId)).toBe(false);
  });

  it('reports a job that has not run yet as pending', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    await sut.enqueueOnce({auditId});

    expect(await sut.isPending(auditId)).toBe(true);
  });

  it('reports a job waiting out a long delay as pending', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    await sut.enqueueOnce({auditId}, {delayMs: 3_600_000});

    expect(await sut.isPending(auditId)).toBe(true);
  });

  it('reports an audit the queue never took as neither held nor pending', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    expect(await sut.has('404')).toBe(false);
    expect(await sut.isPending('404')).toBe(false);
  });

  it('still finds a delayed job, so its audit row is never deleted from under it', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    await sut.enqueueOnce({auditId}, {delayMs: 3_600_000});

    expect(await sut.has(auditId)).toBe(true);
  });

  it('leaves finished work out of the backlog', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    worker = makeWorker<AuditJob>(name, connectionUrl(), (job) => {
      if (job.data.auditId === '555') {
        return Promise.reject(new Error('permanent'));
      }
      return Promise.resolve();
    });
    await worker.waitUntilReady();

    await queue.add(name, {auditId: '444'}, {attempts: 1});
    await queue.add(name, {auditId: '555'}, {attempts: 1});

    const sut = new BullMqAuditQueue(queue);
    await vi.waitFor(
      async () => {
        expect(await sut.backlogCount()).toBe(0);
      },
      {timeout: 10_000},
    );

    expect(await queue.getJobCountByTypes('completed')).toBe(1);
    expect(await queue.getJobCountByTypes('failed')).toBe(1);
  });

  it('does not collide with the ids BullMQ assigns itself', async () => {
    const name = `audit-${randomUUID()}`;
    queue = makeQueue<AuditJob>(name, connectionUrl());
    const sut = new BullMqAuditQueue(queue);

    const assigned = await queue.add(name, {auditId: 'other'});
    expect(assigned.id).toBe('1');

    await sut.enqueueOnce({auditId: '1'});

    expect((await queue.getJob('1'))?.data).toEqual({auditId: 'other'});
    expect(await sut.has('1')).toBe(true);
  });
});
