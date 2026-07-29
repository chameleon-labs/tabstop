import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { makeQueue, makeWorker, setGlobalConcurrency } from './bullmq-helper.js'
import type { PayloadQueue, PayloadWorker } from './bullmq-helper.js'

type TestPayload = { value: string }

const connectionUrl = (): string => {
  const url = process.env.REDIS_URL
  if (url === undefined) throw new Error('REDIS_URL not set by globalSetup')
  return url
}

/** Long enough that two overlapping jobs cannot miss each other. */
const JOB_DURATION_MS = 150

describe('setGlobalConcurrency', () => {
  let queue: PayloadQueue<TestPayload> | null = null
  let workers: Array<PayloadWorker<TestPayload>> = []

  afterEach(async () => {
    try {
      await Promise.all(workers.map(async (worker) => { await worker.close() }))
    } finally {
      await queue?.close()
      workers = []
      queue = null
    }
  })

  /**
   * Runs `jobCount` jobs across `workerCount` separate Worker instances - the
   * closest a test gets to separate worker processes, and the thing that
   * matters here: `concurrency` on a Worker is per instance, so this is
   * exactly the arrangement it cannot bound.
   *
   * Returns the highest number of jobs ever running at the same moment.
   */
  const peakConcurrency = async (
    { workerCount, jobCount, globalConcurrency }:
    { workerCount: number, jobCount: number, globalConcurrency?: number }
  ): Promise<number> => {
    const name = `concurrency-${randomUUID()}`
    queue = makeQueue<TestPayload>(name, connectionUrl())

    if (globalConcurrency !== undefined) {
      await setGlobalConcurrency(name, connectionUrl(), globalConcurrency)
    }

    let running = 0
    let peak = 0
    let finished = 0

    workers = Array.from({ length: workerCount }, () =>
      makeWorker<TestPayload>(name, connectionUrl(), async () => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, JOB_DURATION_MS))
        running -= 1
        finished += 1
      }, { concurrency: 1 })
    )
    await Promise.all(workers.map(async (worker) => { await worker.waitUntilReady() }))

    await queue.addBulk(
      Array.from({ length: jobCount }, (_unused, index) => ({
        name, data: { value: `job-${index}` }
      }))
    )

    const deadline = Date.now() + 30_000
    while (finished < jobCount) {
      if (Date.now() > deadline) throw new Error(`Only ${finished}/${jobCount} jobs ran`)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    return peak
  }

  it('holds one audit at a time under a burst, across several workers', async () => {
    // The acceptance criterion from #8: however many audits queue up, only N
    // Chromium instances run at once. Two workers, each locally allowed one
    // job, would otherwise run two - which is what makes this a real
    // assertion rather than a restatement of `concurrency: 1`.
    expect(await peakConcurrency({
      workerCount: 2, jobCount: 6, globalConcurrency: 1
    })).toBe(1)
  })

  it('proves the same burst exceeds the cap without it', async () => {
    // The control. Without a global limit the identical arrangement runs two
    // jobs at once, so the assertion above is measuring the limit rather than
    // a queue too slow to overlap anything.
    expect(await peakConcurrency({ workerCount: 2, jobCount: 6 })).toBe(2)
  })

  it('permits the configured number, not merely one', async () => {
    // A limit that only ever worked at 1 would pass the first spec and cap
    // every deployment at a single audit no matter what AUDIT_CONCURRENCY says.
    expect(await peakConcurrency({
      workerCount: 3, jobCount: 9, globalConcurrency: 2
    })).toBe(2)
  })
})
