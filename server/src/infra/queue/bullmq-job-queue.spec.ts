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
  let worker: PayloadWorker<AuditJob> | null = null

  afterEach(async () => {
    try {
      await worker?.close()
    } finally {
      await queue?.close()
      worker = null
      queue = null
    }
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

  it('counts the jobs that are runnable now, and not the ones scheduled for later', async () => {
    // The whole queue cap rests on this number meaning what submission thinks
    // it means: how much accepted work is competing for a worker slot NOW.
    //
    // This counted delayed jobs too, on the premise that nothing enqueued an
    // audit with a delay of its own - so "delayed" could only mean "threw, and
    // is inside its retry backoff". #13 made that false: the daily scheduler
    // hands the queue a night's work with delays of up to six hours. Counted
    // as backlog, a hundred monitored pages would push the depth over
    // AUDIT_QUEUE_MAX_DEPTH the instant the fan-out ran, and POST /api/audits
    // would answer 503 for the length of the window, nightly, against idle
    // workers.
    //
    // Driven against real BullMQ rather than a fake, because which state a
    // job is in is BullMQ's decision, not ours: a fake would simply agree
    // with whichever method we happened to call.
    const name = `audit-${randomUUID()}`
    queue = makeQueue<AuditJob>(name, connectionUrl())
    const sut = new BullMqAuditQueue(queue)

    expect(await sut.backlogCount()).toBe(0)

    await sut.enqueueOnce({ auditId: '111' })
    await sut.enqueueOnce({ auditId: '222' })
    expect(await sut.backlogCount()).toBe(2)

    // Accepted, and deliberately not competing for a slot yet.
    await sut.enqueueOnce({ auditId: '333' }, { delayMs: 60_000 })
    expect(await queue.getJobCountByTypes('delayed')).toBe(1)
    expect(await sut.backlogCount()).toBe(2)

    // Deduped rather than counted twice, matching enqueueOnce's contract.
    await sut.enqueueOnce({ auditId: '111' })
    expect(await sut.backlogCount()).toBe(2)
  })

  it('counts a scheduled job once its delay has elapsed', async () => {
    // The other half of the rule above, and what keeps it a bound rather than
    // a hole: work scheduled into the future is uncounted only while it IS in
    // the future. When its time comes it joins the runnable line, and a
    // saturated worker refuses submissions exactly as it did before.
    //
    // A worker has to be running for that to happen at all - BullMQ promotes
    // the delayed set from the workers, so with none attached a delayed job
    // stays delayed forever and this reads zero indefinitely. Worth knowing
    // beyond this spec: the depth check is only a live number while something
    // is consuming the queue.
    //
    // The worker blocks on a gate and takes one job at the default concurrency
    // of one, so the second promoted job is left waiting where it can be
    // counted rather than being finished before the assertion runs.
    const name = `audit-${randomUUID()}`
    queue = makeQueue<AuditJob>(name, connectionUrl())
    const sut = new BullMqAuditQueue(queue)

    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    worker = makeWorker<AuditJob>(name, connectionUrl(), async () => { await gate })
    await worker.waitUntilReady()

    try {
      await sut.enqueueOnce({ auditId: '777' }, { delayMs: 500 })
      await sut.enqueueOnce({ auditId: '778' }, { delayMs: 500 })
      expect(await sut.backlogCount()).toBe(0)

      // At least one, not exactly one. Both jobs are promoted together and the
      // worker takes them one at a time, so the count passes through 2 on its
      // way to 1 - and asserting the exact value made this spec race against
      // however busy the shared Redis was, which is not what it is about.
      await vi.waitFor(async () => {
        expect(await sut.backlogCount()).toBeGreaterThanOrEqual(1)
      }, { timeout: 20_000 })
    } finally {
      release()
    }
  })

  it('hands the delay to BullMQ rather than sleeping on it', async () => {
    // A fan-out that waited out its own jitter would hold the run open for six
    // hours and lose every page it had not reached if the worker restarted.
    const name = `audit-${randomUUID()}`
    queue = makeQueue<AuditJob>(name, connectionUrl())
    const sut = new BullMqAuditQueue(queue)

    const before = Date.now()
    await sut.enqueueOnce({ auditId }, { delayMs: 3_600_000 })
    const elapsed = Date.now() - before

    const job = await queue.getJob(`audit-${auditId}`)
    expect(job?.opts.delay).toBe(3_600_000)
    expect(await job?.getState()).toBe('delayed')
    expect(elapsed).toBeLessThan(5_000)
  })

  it('still finds a delayed job, so its audit row is never deleted from under it', async () => {
    // has() is what turns an unconfirmed enqueue into `unknown` rather than
    // `failed`. If it could not see a delayed job, a scheduler retry would
    // report failure and delete an audit row whose job is sitting in the
    // delayed set, waiting for a slot it will get.
    const name = `audit-${randomUUID()}`
    queue = makeQueue<AuditJob>(name, connectionUrl())
    const sut = new BullMqAuditQueue(queue)

    await sut.enqueueOnce({ auditId }, { delayMs: 3_600_000 })

    expect(await sut.has(auditId)).toBe(true)
  })

  it('leaves finished work out of the backlog', async () => {
    // The other half of the boundary: a job that has run is not owed a slot,
    // so a queue that has done a lot of work must not look saturated. Failed
    // jobs are kept for a day by removeOnFail, so this would be a slow leak
    // into the depth check if the count reached for them.
    const name = `audit-${randomUUID()}`
    queue = makeQueue<AuditJob>(name, connectionUrl())
    worker = makeWorker<AuditJob>(name, connectionUrl(), async (job) => {
      if (job.data.auditId === '555') throw new Error('permanent')
    })
    await worker.waitUntilReady()

    await queue.add(name, { auditId: '444' }, { attempts: 1 })
    await queue.add(name, { auditId: '555' }, { attempts: 1 })

    const sut = new BullMqAuditQueue(queue)
    await vi.waitFor(async () => {
      expect(await sut.backlogCount()).toBe(0)
    }, { timeout: 10_000 })

    expect(await queue.getJobCountByTypes('completed')).toBe(1)
    expect(await queue.getJobCountByTypes('failed')).toBe(1)
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
