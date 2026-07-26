import type { JobQueue } from '../../data/protocols/queue/job-queue.js'
import type { PayloadQueue } from './helpers/bullmq-helper.js'

export class BullMqJobQueue<TPayload> implements JobQueue<TPayload> {
  constructor (private readonly queue: PayloadQueue<TPayload>) {}

  async enqueue (payload: TPayload): Promise<void> {
    await this.queue.add(this.queue.name, payload)
  }
}
