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
