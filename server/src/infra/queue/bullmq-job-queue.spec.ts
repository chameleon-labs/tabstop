import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { makeQueue, makeWorker } from './helpers/bullmq-helper.js'
import { BullMqJobQueue } from './bullmq-job-queue.js'
import type { PayloadQueue, PayloadWorker } from './helpers/bullmq-helper.js'

type TestPayload = { value: string }

const connectionUrl = (): string => {
  const url = process.env.REDIS_URL
  if (url === undefined) throw new Error('REDIS_URL not set by globalSetup')
  return url
}

describe('BullMqJobQueue', () => {
  let queue: PayloadQueue<TestPayload> | null = null
  let worker: PayloadWorker<TestPayload> | null = null

  afterEach(async () => {
    try {
      await worker?.close()
    } finally {
      await queue?.close()
      worker = null
      queue = null
    }
  })

  it('round-trips a payload from enqueue to a consumer', async () => {
    const name = `test-${randomUUID()}`
    const received: TestPayload[] = []

    queue = makeQueue<TestPayload>(name, connectionUrl())
    worker = makeWorker<TestPayload>(name, connectionUrl(), async (job) => {
      received.push(job.data)
    })
    await worker.waitUntilReady()

    const sut = new BullMqJobQueue(queue)
    await sut.enqueue({ value: 'hello' })

    await vi.waitFor(() => { expect(received).toEqual([{ value: 'hello' }]) }, { timeout: 10_000 })
  })

  it('retries a failing handler and succeeds on a later attempt', async () => {
    const name = `test-${randomUUID()}`
    let attempts = 0

    queue = makeQueue<TestPayload>(name, connectionUrl())
    worker = makeWorker<TestPayload>(name, connectionUrl(), async () => {
      attempts += 1
      if (attempts < 3) throw new Error('transient')
    })
    await worker.waitUntilReady()

    // Per-job override: the queue default uses exponential backoff from 1s,
    // which would make this spec take seconds for no extra coverage.
    const job = await queue.add(name, { value: 'retry me' }, { attempts: 3, backoff: { type: 'fixed', delay: 10 } })

    const jobId = job.id
    if (jobId === undefined) throw new Error('BullMQ did not assign a job id')

    await vi.waitFor(async () => {
      const stored = await queue?.getJob(jobId)
      expect(stored?.attemptsMade).toBe(3)
      expect(await stored?.getState()).toBe('completed')
    }, { timeout: 10_000 })
  })

  it('applies the shared default job options', () => {
    const name = `test-${randomUUID()}`
    queue = makeQueue<TestPayload>(name, connectionUrl())

    expect(queue.jobsOpts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    })
  })
})
