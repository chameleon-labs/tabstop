import {Queue, Worker, type Job, type JobSchedulerTemplateOptions, type Processor, type WorkerOptions} from 'bullmq';

/**
 * BullMQ's Queue and Worker generics are asymmetric.
 *
 * Queue derives its name type via ExtractNameType<DataTypeOrJob, string>, a
 * conditional that never resolves for a bare generic payload - so add() would
 * reject a plain string name. Passing Job<...> makes the conditional take its
 * true branch. Worker has plain generics and needs the opposite form.
 */
export type PayloadQueue<TPayload> = Queue<Job<TPayload, void, string>>;
export type PayloadWorker<TPayload> = Worker<TPayload, void, string>;

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {type: 'exponential', delay: 1000},
  removeOnComplete: {age: 3600, count: 100},
  removeOnFail: {age: 86_400},
};

export const makeQueue = <TPayload>(name: string, connectionUrl: string): PayloadQueue<TPayload> =>
  new Queue<Job<TPayload, void, string>>(name, {
    connection: {url: connectionUrl},
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

const MANUAL_RATE_LIMIT_VALUE = String(Number.MAX_SAFE_INTEGER);
const RATE_LIMIT_FOR_AT_LEAST_COMMAND = 'tabstopRateLimitForAtLeast';
const clientsWithRateLimitCommand = new WeakSet<object>();

const RATE_LIMIT_FOR_AT_LEAST_SCRIPT = `
local ttl = redis.call('PTTL', KEYS[1])
local requested = tonumber(ARGV[1])

if ttl == -1 or ttl >= requested then
  redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
else
  redis.call('SET', KEYS[1], ARGV[2], 'PX', requested)
end
`;

export const rateLimitForAtLeast = async <TPayload>(
  queue: PayloadQueue<TPayload>,
  durationMs: number,
): Promise<void> => {
  const client = await queue.client;
  if (!clientsWithRateLimitCommand.has(client)) {
    client.defineCommand(RATE_LIMIT_FOR_AT_LEAST_COMMAND, {
      numberOfKeys: 1,
      lua: RATE_LIMIT_FOR_AT_LEAST_SCRIPT,
    });
    clientsWithRateLimitCommand.add(client);
  }
  await client.runCommand(RATE_LIMIT_FOR_AT_LEAST_COMMAND, [
    queue.toKey('limiter'),
    durationMs,
    MANUAL_RATE_LIMIT_VALUE,
  ]);
};

/**
 * Caps how many of this queue's jobs run at once across EVERY worker process.
 *
 * `concurrency` on the Worker is a per-process number. Two replicas of the
 * worker configured with `AUDIT_CONCURRENCY=3` run six Chromium instances
 * between them, so the cost backstop the setting exists to be is only as good
 * as a replica count nothing enforces. This limit lives in Redis and every
 * worker on the queue respects it, so the ceiling holds however many
 * processes are consuming.
 *
 * Set at worker startup, which means the value is whatever the most recently
 * started worker was configured with - correct while replicas share a
 * deployment's environment, and the reason the per-process `concurrency` is
 * still passed as well: that one bounds a single process even if this call
 * never happened.
 */
export const setGlobalConcurrency = async (name: string, connectionUrl: string, concurrency: number): Promise<void> => {
  const queue = makeQueue(name, connectionUrl);
  try {
    await queue.setGlobalConcurrency(concurrency);
  } finally {
    await queue.close();
  }
};

/**
 * Registers a recurring job, or updates the one already registered under this
 * id.
 *
 * The schedule lives in Redis, so it fires ONCE across every worker replica -
 * which is the whole reason a nightly fan-out uses this rather than a timer.
 * A timer fires per process, so N replicas would race on the same rows every
 * night.
 *
 * An upsert rather than an add because this runs on every worker boot: a
 * deploy that changes the cron has to take effect, not leave the old schedule
 * running and add a second one beside it.
 *
 * `jobOptions` are the fired job's - attempts and backoff for one run - not
 * the schedule's.
 */
export const upsertDailySchedule = async <TPayload>(
  queue: PayloadQueue<TPayload>,
  schedulerId: string,
  pattern: string,
  timezone: string,
  jobOptions: JobSchedulerTemplateOptions = {},
): Promise<void> => {
  await queue.upsertJobScheduler(schedulerId, {pattern, tz: timezone}, {name: queue.name, opts: jobOptions});
};

export const makeWorker = <TPayload>(
  name: string,
  connectionUrl: string,
  processor: Processor<TPayload, void, string>,
  options: Omit<WorkerOptions, 'connection'> = {},
): PayloadWorker<TPayload> =>
  new Worker<TPayload, void, string>(name, processor, {
    ...options,
    connection: {url: connectionUrl},
  });
