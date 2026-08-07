import {randomUUID} from 'node:crypto';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {AlertQueuePayload} from '../../main/config/queue-names.js';
import {BullMqAlertEmailQueue} from './bullmq-alert-email-queue.js';
import {makeQueue, makeWorker, type PayloadQueue, type PayloadWorker} from './helpers/bullmq-helper.js';

describe('BullMqAlertEmailQueue', () => {
  let queue: PayloadQueue<AlertQueuePayload>;
  let worker: PayloadWorker<AlertQueuePayload> | null;

  beforeEach(() => {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl === undefined) {
      throw new Error('REDIS_URL not set by globalSetup');
    }
    queue = makeQueue(`alert-email-${randomUUID()}`, redisUrl);
    worker = null;
  });

  afterEach(async () => {
    await worker?.close();
    await queue.obliterate({force: true});
    await queue.close();
  });

  it('deduplicates retries for the same AlertEvent', async () => {
    const sut = new BullMqAlertEmailQueue(queue);

    await sut.enqueueOnce({alertEventId: '42'});
    await sut.enqueueOnce({alertEventId: '42'});

    const jobs = await queue.getJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe('alert-email-42');
    expect(jobs[0]?.name).toBe('send');
    expect(jobs[0]?.data).toEqual({kind: 'send', alertEventId: '42'});
  });

  it('revives an exhausted job so an unsent database event cannot stay blocked by retention', async () => {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl === undefined) {
      throw new Error('REDIS_URL not set by globalSetup');
    }
    worker = makeWorker(queue.name, redisUrl, () => Promise.reject(new Error('provider unavailable')));
    await worker.waitUntilReady();
    await queue.add(
      'send',
      {kind: 'send', alertEventId: '99'},
      {
        jobId: 'alert-email-99',
        attempts: 1,
      },
    );
    await vi.waitFor(
      async () => {
        expect(await (await queue.getJob('alert-email-99'))?.getState()).toBe('failed');
      },
      {timeout: 10_000},
    );
    await worker.close();
    worker = null;

    await new BullMqAlertEmailQueue(queue).enqueueOnce({alertEventId: '99'});

    const revived = await queue.getJob('alert-email-99');
    expect(await revived?.getState()).toBe('waiting');
    expect(revived?.attemptsMade).toBe(0);
  });

  it('revives a completed console preview when the real provider is enabled later', async () => {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl === undefined) {
      throw new Error('REDIS_URL not set by globalSetup');
    }
    worker = makeWorker(queue.name, redisUrl, () => Promise.resolve());
    await worker.waitUntilReady();
    await queue.add(
      'send',
      {kind: 'send', alertEventId: '100'},
      {
        jobId: 'alert-email-100',
        attempts: 1,
      },
    );
    await vi.waitFor(
      async () => {
        expect(await (await queue.getJob('alert-email-100'))?.getState()).toBe('completed');
      },
      {timeout: 10_000},
    );
    await worker.close();
    worker = null;

    await new BullMqAlertEmailQueue(queue, true).enqueueOnce({alertEventId: '100'});

    const revived = await queue.getJob('alert-email-100');
    expect(await revived?.getState()).toBe('waiting');
    expect(revived?.attemptsMade).toBe(0);
  });
});
