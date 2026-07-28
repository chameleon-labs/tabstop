import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { makeQueue, makeWorker } from './helpers/bullmq-helper.js'
import { BullMqAuditQueue, BullMqJobQueue } from './bullmq-job-queue.js'
import type { PayloadQueue, PayloadWorker } from './helpers/bullmq-helper.js'
import type { AuditJob } from '../../data/protocols/queue/audit-job-queue.js'

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

  it('lands a job in the failed state once its attempts are exhausted', async () => {
    const name = `test-${randomUUID()}`
    let attempts = 0

    queue = makeQueue<TestPayload>(name, connectionUrl())
    worker = makeWorker<TestPayload>(name, connectionUrl(), async () => {
      attempts += 1
      throw new Error('permanent')
    })
    await worker.waitUntilReady()

    const job = await queue.add(name, { value: 'always fails' }, { attempts: 3, backoff: { type: 'fixed', delay: 10 } })

    const jobId = job.id
    if (jobId === undefined) throw new Error('BullMQ did not assign a job id')

    await vi.waitFor(async () => {
      // getJob resolving at all is part of the assertion: removeOnFail keeps
      // failed jobs for a day precisely so a failure can be inspected. If that
      // default is ever changed to drop them, this lookup returns undefined.
      const stored = await queue?.getJob(jobId)
      expect(await stored?.getState()).toBe('failed')
      expect(stored?.attemptsMade).toBe(3)
      expect(stored?.failedReason).toBe('permanent')
    }, { timeout: 10_000 })

    expect(attempts).toBe(3)
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

describe('BullMqAuditQueue', () => {
  let queue: PayloadQueue<AuditJob> | null = null

  afterEach(async () => {
    await queue?.close()
    queue = null
  })

  // audits.id is a bigserial, so in production every audit id is all digits -
  // and BullMQ rejects an all-digit custom id, because it would collide with
  // the ids it mints itself. With the id passed through unprefixed, every
  // enqueue this queue exists to perform threw "Custom Id cannot be integers".
  const auditId = '12345'

  it('enqueues an audit whose id is all digits', async () => {
    const name = `audit-${randomUUID()}`
    queue = makeQueue<AuditJob>(name, connectionUrl())
    const sut = new BullMqAuditQueue(queue)

    await sut.enqueueOnce({ auditId })

    const jobs = await queue.getJobs(['waiting', 'prioritized', 'delayed', 'active'])
    expect(jobs.map((job) => job.data)).toEqual([{ auditId }])
  })

  it('enqueues one job when the same audit is submitted twice', async () => {
    const name = `audit-${randomUUID()}`
    queue = makeQueue<AuditJob>(name, connectionUrl())
    const sut = new BullMqAuditQueue(queue)

    await sut.enqueueOnce({ auditId })
    await sut.enqueueOnce({ auditId })

    expect(await queue.getJobCountByTypes('waiting', 'prioritized', 'delayed', 'active')).toBe(1)
  })

  it('finds a job it enqueued, and reports an unknown audit as absent', async () => {
    // has() derives the job id the same way enqueueOnce does. If the two ever
    // diverge, the lookup silently answers false and the recovery path it
    // guards deletes a row whose job is still queued.
    const name = `audit-${randomUUID()}`
    queue = makeQueue<AuditJob>(name, connectionUrl())
    const sut = new BullMqAuditQueue(queue)

    await sut.enqueueOnce({ auditId })

    expect(await sut.has(auditId)).toBe(true)
    expect(await sut.has('67890')).toBe(false)
  })

  it('does not collide with the ids BullMQ assigns itself', async () => {
    // The reason BullMQ refuses integer custom ids: its own counter would
    // reach the same value and overwrite the job.
    const name = `audit-${randomUUID()}`
    queue = makeQueue<AuditJob>(name, connectionUrl())
    const sut = new BullMqAuditQueue(queue)

    const assigned = await queue.add(name, { auditId: 'other' })
    expect(assigned.id).toBe('1')

    await sut.enqueueOnce({ auditId: '1' })

    expect((await queue.getJob('1'))?.data).toEqual({ auditId: 'other' })
    expect(await sut.has('1')).toBe(true)
  })
})
