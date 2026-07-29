import { Queue, Worker, type Job, type Processor, type WorkerOptions } from 'bullmq'

/**
 * BullMQ's Queue and Worker generics are asymmetric.
 *
 * Queue derives its name type via ExtractNameType<DataTypeOrJob, string>, a
 * conditional that never resolves for a bare generic payload - so add() would
 * reject a plain string name. Passing Job<...> makes the conditional take its
 * true branch. Worker has plain generics and needs the opposite form.
 */
export type PayloadQueue<TPayload> = Queue<Job<TPayload, void, string>>
export type PayloadWorker<TPayload> = Worker<TPayload, void, string>

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: { age: 3600, count: 100 },
  removeOnFail: { age: 86_400 }
}

export const makeQueue = <TPayload>(name: string, connectionUrl: string): PayloadQueue<TPayload> =>
  new Queue<Job<TPayload, void, string>>(name, {
    connection: { url: connectionUrl },
    defaultJobOptions: DEFAULT_JOB_OPTIONS
  })

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
export const setGlobalConcurrency = async (
  name: string, connectionUrl: string, concurrency: number
): Promise<void> => {
  const queue = makeQueue(name, connectionUrl)
  try {
    await queue.setGlobalConcurrency(concurrency)
  } finally {
    await queue.close()
  }
}

export const makeWorker = <TPayload>(
  name: string,
  connectionUrl: string,
  processor: Processor<TPayload, void, string>,
  options: Omit<WorkerOptions, 'connection'> = {}
): PayloadWorker<TPayload> =>
  new Worker<TPayload, void, string>(name, processor, {
    ...options,
    connection: { url: connectionUrl }
  })
