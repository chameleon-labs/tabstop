import {
  Queue,
  Worker,
  type Job,
  type JobSchedulerTemplateOptions,
  type Processor,
  type RedisClient,
  type WorkerOptions,
} from 'bullmq';

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

export const queueClient = <TPayload>(queue: PayloadQueue<TPayload>): Promise<RedisClient> => queue.getBackend().client;

export const rateLimitForAtLeast = async <TPayload>(
  queue: PayloadQueue<TPayload>,
  durationMs: number,
): Promise<void> => {
  const client = await queueClient(queue);
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

export const setGlobalConcurrency = async (name: string, connectionUrl: string, concurrency: number): Promise<void> => {
  const queue = makeQueue(name, connectionUrl);
  try {
    await queue.setGlobalConcurrency(concurrency);
  } finally {
    await queue.close();
  }
};

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
