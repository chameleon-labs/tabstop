import {afterEach, describe, expect, it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {
  makeQueue,
  makeWorker,
  rateLimitForAtLeast,
  setGlobalConcurrency,
  upsertDailySchedule,
} from './bullmq-helper.js';
import type {PayloadQueue, PayloadWorker} from './bullmq-helper.js';

type TestPayload = {value: string};

const connectionUrl = (): string => {
  const url = process.env.REDIS_URL;
  if (url === undefined) {
    throw new Error('REDIS_URL not set by globalSetup');
  }
  return url;
};

/** Long enough that two overlapping jobs cannot miss each other. */
const JOB_DURATION_MS = 150;

describe('setGlobalConcurrency', () => {
  let queue: PayloadQueue<TestPayload> | null = null;
  let workers: PayloadWorker<TestPayload>[] = [];

  afterEach(async () => {
    try {
      await Promise.all(
        workers.map(async (worker) => {
          await worker.close();
        }),
      );
    } finally {
      await queue?.close();
      workers = [];
      queue = null;
    }
  });

  /**
   * Runs `jobCount` jobs across `workerCount` separate Worker instances - the
   * closest a test gets to separate worker processes, and the thing that
   * matters here: `concurrency` on a Worker is per instance, so this is
   * exactly the arrangement it cannot bound.
   *
   * Returns the highest number of jobs ever running at the same moment.
   */
  const peakConcurrency = async ({
    workerCount,
    jobCount,
    globalConcurrency,
  }: {
    workerCount: number;
    jobCount: number;
    globalConcurrency?: number;
  }): Promise<number> => {
    const name = `concurrency-${randomUUID()}`;
    queue = makeQueue<TestPayload>(name, connectionUrl());

    if (globalConcurrency !== undefined) {
      await setGlobalConcurrency(name, connectionUrl(), globalConcurrency);
    }

    let running = 0;
    let peak = 0;
    let finished = 0;

    workers = Array.from({length: workerCount}, () =>
      makeWorker<TestPayload>(
        name,
        connectionUrl(),
        async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => {
            setTimeout(resolve, JOB_DURATION_MS);
          });
          running -= 1;
          finished += 1;
        },
        {concurrency: 1},
      ),
    );
    await Promise.all(
      workers.map(async (worker) => {
        await worker.waitUntilReady();
      }),
    );

    await queue.addBulk(
      Array.from({length: jobCount}, (_unused, index) => ({
        name,
        data: {value: `job-${index}`},
      })),
    );

    const deadline = Date.now() + 30_000;
    // oxlint-disable-next-line no-unmodified-loop-condition -- the workers above mutate `finished`
    while (finished < jobCount) {
      if (Date.now() > deadline) {
        throw new Error(`Only ${finished}/${jobCount} jobs ran`);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });
    }

    return peak;
  };

  it('holds one audit at a time under a burst, across several workers', async () => {
    // The acceptance criterion from #8: however many audits queue up, only N
    // Chromium instances run at once. Two workers, each locally allowed one
    // job, would otherwise run two - which is what makes this a real
    // assertion rather than a restatement of `concurrency: 1`.
    expect(
      await peakConcurrency({
        workerCount: 2,
        jobCount: 6,
        globalConcurrency: 1,
      }),
    ).toBe(1);
  });

  it('proves the same burst exceeds the cap without it', async () => {
    // The control. Without a global limit the identical arrangement runs two
    // jobs at once, so the assertion above is measuring the limit rather than
    // a queue too slow to overlap anything.
    expect(await peakConcurrency({workerCount: 2, jobCount: 6})).toBe(2);
  });

  it('permits the configured number, not merely one', async () => {
    // A limit that only ever worked at 1 would pass the first spec and cap
    // every deployment at a single audit no matter what AUDIT_CONCURRENCY says.
    expect(
      await peakConcurrency({
        workerCount: 3,
        jobCount: 9,
        globalConcurrency: 2,
      }),
    ).toBe(2);
  });
});

/**
 * The registration nothing else covers.
 *
 * The nightly run's own specs drive the usecase directly, so all of them pass
 * with no schedule registered at all: a cron that never fires, a timezone
 * silently dropped, or a template that loses its retry options would ship
 * green. Everything here reads the schedule back out of Redis rather than
 * trusting the call not to have thrown.
 */
describe('upsertDailySchedule', () => {
  let queue: PayloadQueue<TestPayload> | null = null;

  afterEach(async () => {
    await queue?.close();
    queue = null;
  });

  const CRON = '0 2 * * *';

  const scheduleQueue = (): PayloadQueue<TestPayload> => {
    queue = makeQueue<TestPayload>(`schedule-${randomUUID()}`, connectionUrl());
    return queue;
  };

  it('registers a recurring job with the cron and timezone it was given', async () => {
    const target = scheduleQueue();

    await upsertDailySchedule(target, 'daily-reaudit', CRON, 'UTC');

    const schedulers = await target.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.key).toBe('daily-reaudit');
    expect(schedulers[0]?.pattern).toBe(CRON);
    // The timezone is the difference between "every 24h in UTC" - which is
    // what the day-boundary dedupe assumes - and "whenever the worker host
    // thinks 02:00 is", which moves the run twice a year on a host with DST.
    expect(schedulers[0]?.tz).toBe('UTC');
  });

  it('queues the first run rather than only recording the schedule', async () => {
    // A registration that stored a pattern and produced no job would satisfy
    // every assertion above.
    const target = scheduleQueue();

    await upsertDailySchedule(target, 'daily-reaudit', CRON, 'UTC');

    expect(await target.getJobCountByTypes('delayed')).toBe(1);
  });

  it('carries the job options the template was given', async () => {
    // The fan-out's retry policy lives here rather than in the queue defaults,
    // because a minute of backoff is right for it and wrong for an audit
    // somebody is waiting on. Dropped silently, a run that hit a Redis blip
    // would retry twice inside three seconds and give up.
    const target = scheduleQueue();

    await upsertDailySchedule(target, 'daily-reaudit', CRON, 'UTC', {
      attempts: 3,
      backoff: {type: 'exponential', delay: 60_000},
    });

    const [job] = await target.getDelayed();
    expect(job?.opts.attempts).toBe(3);
    expect(job?.opts.backoff).toEqual({type: 'exponential', delay: 60_000});
  });

  it('updates the schedule in place rather than adding a second one', async () => {
    // This runs on every worker boot. If it added rather than replaced, a
    // deploy that changed the cron would leave both schedules registered and
    // the fan-out would fire twice a night - which the day-scoped unique index
    // absorbs, silently, so nothing would ever surface the mistake.
    const target = scheduleQueue();

    await upsertDailySchedule(target, 'daily-reaudit', CRON, 'UTC');
    await upsertDailySchedule(target, 'daily-reaudit', '30 3 * * *', 'UTC');

    const schedulers = await target.getJobSchedulers();
    expect(schedulers).toHaveLength(1);
    expect(schedulers[0]?.pattern).toBe('30 3 * * *');
  });
});

describe('rateLimitForAtLeast', () => {
  let queues: PayloadQueue<TestPayload>[] = [];

  afterEach(async () => {
    try {
      await queues[0]?.obliterate({force: true});
    } finally {
      await Promise.all(
        queues.map(async (queue) => {
          await queue.close();
        }),
      );
      queues = [];
    }
  });

  const replicas = (): [PayloadQueue<TestPayload>, PayloadQueue<TestPayload>] => {
    const name = `provider-backoff-${randomUUID()}`;
    const first = makeQueue<TestPayload>(name, connectionUrl());
    const second = makeQueue<TestPayload>(name, connectionUrl());
    queues.push(first, second);
    return [first, second];
  };

  const limiterState = async (queue: PayloadQueue<TestPayload>) => {
    const client = await queue.client;
    return {
      value: await client.get(queue.toKey('limiter')),
      ttl: await queue.getRateLimitTtl(),
    };
  };

  it('creates BullMQ’s manual limiter value when no backoff exists', async () => {
    const [queue] = replicas();

    await rateLimitForAtLeast(queue, 10_000);

    const state = await limiterState(queue);
    expect(state.value).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(state.ttl).toBeGreaterThan(8_000);
    expect(state.ttl).toBeLessThanOrEqual(10_000);
  });

  it('promotes the counter without replacing a longer delay with a shorter one', async () => {
    const [first, second] = replicas();
    const client = await first.client;
    await client.set(first.toKey('limiter'), '1', {PX: 10_000});
    const before = await limiterState(first);

    await rateLimitForAtLeast(second, 1_000);

    const after = await limiterState(first);
    expect(after.value).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(after.ttl).toBeGreaterThan(8_000);
    expect(after.ttl).toBeLessThanOrEqual(before.ttl);
  });

  it('extends a shorter delay to the requested longer delay', async () => {
    const [first, second] = replicas();
    const client = await first.client;
    await client.set(first.toKey('limiter'), '1', {PX: 1_000});

    await rateLimitForAtLeast(second, 10_000);

    const state = await limiterState(first);
    expect(state.value).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(state.ttl).toBeGreaterThan(8_000);
    expect(state.ttl).toBeLessThanOrEqual(10_000);
  });

  it.each([
    ['short request starts first', 1_000, 10_000],
    ['long request starts first', 10_000, 1_000],
  ])('keeps the longest delay when replicas race: %s', async (_case, firstDelay, secondDelay) => {
    const [first, second] = replicas();

    await Promise.all([rateLimitForAtLeast(first, firstDelay), rateLimitForAtLeast(second, secondDelay)]);

    const state = await limiterState(first);
    expect(state.value).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(state.ttl).toBeGreaterThan(8_000);
    expect(state.ttl).toBeLessThanOrEqual(10_000);
  });

  it('installs the manual sentinel without expiring an infinite limiter', async () => {
    const [queue] = replicas();
    const client = await queue.client;
    await client.set(queue.toKey('limiter'), '1');

    await rateLimitForAtLeast(queue, 10_000);

    expect(await limiterState(queue)).toEqual({
      value: String(Number.MAX_SAFE_INTEGER),
      ttl: -1,
    });
  });
});
