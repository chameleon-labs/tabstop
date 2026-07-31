import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { makeQueue, type PayloadQueue } from '../../infra/queue/helpers/bullmq-helper.js'
import {
  ALERT_DISPATCH_CRON, ALERT_DISPATCH_SCHEDULER_ID, ALERT_DISPATCH_TIMEZONE
} from '../config/alert-email.js'
import type { AlertQueuePayload } from '../config/queue-names.js'
import { registerAlertEmailDispatcher } from './alert-email-scheduler.js'

describe('registerAlertEmailDispatcher', () => {
  let queue: PayloadQueue<AlertQueuePayload> | null = null

  afterEach(async () => {
    await queue?.close()
    queue = null
  })

  it('upserts one UTC minute schedule carrying a dispatch payload and retries', async () => {
    const redisUrl = process.env.REDIS_URL
    if (redisUrl === undefined) throw new Error('REDIS_URL not set by globalSetup')
    queue = makeQueue(`alert-schedule-${randomUUID()}`, redisUrl)

    await registerAlertEmailDispatcher(queue)
    await registerAlertEmailDispatcher(queue)

    const schedulers = await queue.getJobSchedulers()
    expect(schedulers).toHaveLength(1)
    expect(schedulers[0]).toMatchObject({
      key: ALERT_DISPATCH_SCHEDULER_ID,
      pattern: ALERT_DISPATCH_CRON,
      tz: ALERT_DISPATCH_TIMEZONE
    })
    const [job] = await queue.getDelayed()
    expect(job?.name).toBe('dispatch')
    expect(job?.data).toEqual({ kind: 'dispatch' })
    expect(job?.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    })
  })
})
