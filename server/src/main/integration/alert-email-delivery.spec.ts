import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kysely } from 'kysely'
import { DbDispatchPendingAlertEmails } from '../../data/usecases/alert/dispatch-pending-alert-emails.js'
import { DbSendAlertEmail } from '../../data/usecases/alert/send-alert-email.js'
import type {
  AlertDispatchMode,
  LoadPendingAlertEventsRepository
} from '../../data/protocols/db/alert-event/load-pending-alert-events-repository.js'
import {
  AlertRateLimitError, type AlertSender
} from '../../data/protocols/mail/alert-sender.js'
import type { Database } from '../../infra/db/postgres/database.js'
import {
  PostgresAlertEventRepository
} from '../../infra/db/postgres/alert-event/postgres-alert-event-repository.js'
import { makeDatabase } from '../../infra/db/postgres/helpers/postgres-helper.js'
import { BullMqAlertEmailQueue } from '../../infra/queue/bullmq-alert-email-queue.js'
import {
  makeQueue, makeWorker, rateLimitForAtLeast, type PayloadQueue, type PayloadWorker
} from '../../infra/queue/helpers/bullmq-helper.js'
import { HmacAlertUnsubscribeToken } from '../../infra/cryptography/hmac-alert-unsubscribe-token.js'
import type { AlertQueuePayload } from '../config/queue-names.js'
import {
  ALERT_EMAIL_WORKER_LIMITER, makeAlertEmailJobProcessor
} from '../jobs/alert-email-job-processor.js'

const eventually = async (assertion: () => Promise<void>): Promise<void> => {
  const deadline = Date.now() + 8_000
  for (;;) {
    try {
      await assertion()
      return
    } catch (error) {
      if (Date.now() >= deadline) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, 25))
    }
  }
}

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('alert email delivery pipeline', () => {
  let db: Kysely<Database>
  let queue: PayloadQueue<AlertQueuePayload>
  let worker: PayloadWorker<AlertQueuePayload> | null

  beforeEach(() => {
    const databaseUrl = process.env.DATABASE_URL
    const redisUrl = process.env.REDIS_URL
    if (databaseUrl === undefined || redisUrl === undefined) {
      throw new Error('database and redis URLs not set by globalSetup')
    }
    db = makeDatabase(databaseUrl)
    queue = makeQueue(`alert-delivery-${randomUUID()}`, redisUrl)
    worker = null
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(async () => {
    if (worker !== null) await worker.close()
    await queue.obliterate({ force: true })
    await queue.close()
    await db.destroy()
    vi.restoreAllMocks()
  })

  const seedEvent = async (): Promise<string> => {
    const user = await db.insertInto('users').values({
      email: `${randomUUID()}@test.test`,
      password_digest: 'x'
    }).returning('id').executeTakeFirstOrThrow()
    const site = await db.insertInto('sites').values({
      user_id: user.id,
      domain: `${randomUUID()}.test`
    }).returning('id').executeTakeFirstOrThrow()
    const page = await db.insertInto('pages').values({
      site_id: site.id,
      url: 'https://example.test/checkout'
    }).returning('id').executeTakeFirstOrThrow()
    const previous = await db.insertInto('audits').values({
      page_id: page.id,
      url: 'https://example.test/checkout',
      status: 'done',
      score: 90,
      axe_version: '4.12.1',
      created_at: new Date('2026-07-29T12:00:00Z')
    }).returning('id').executeTakeFirstOrThrow()
    const current = await db.insertInto('audits').values({
      page_id: page.id,
      url: 'https://example.test/checkout',
      status: 'done',
      score: 80,
      axe_version: '4.12.1',
      created_at: new Date('2026-07-30T12:00:00Z')
    }).returning('id').executeTakeFirstOrThrow()

    return (await db.insertInto('alert_events').values({
      page_id: page.id,
      audit_id: current.id,
      previous_audit_id: previous.id,
      kind: 'score_drop'
    }).returning('id').executeTakeFirstOrThrow()).id
  }

  const start = async (
    sender: AlertSender,
    alertEventId: string,
    mode: AlertDispatchMode = 'delivery'
  ): Promise<DbDispatchPendingAlertEmails> => {
    const redisUrl = process.env.REDIS_URL
    if (redisUrl === undefined) throw new Error('REDIS_URL not set by globalSetup')
    const repository = new PostgresAlertEventRepository(db)
    const dispatchAlerts = makeScopedPendingAlertEventsRepository(alertEventId)
    const send = new DbSendAlertEmail(
      repository,
      sender,
      new HmacAlertUnsubscribeToken('integration-secret-'.repeat(3)),
      'Tabstop <alerts@alerts.example.test>',
      'https://app.tabstop.dev',
      'https://api.tabstop.dev',
      mode
    )
    worker = makeWorker<AlertQueuePayload>(queue.name, redisUrl, makeAlertEmailJobProcessor({
      rateLimit: async (durationMs) => {
        await rateLimitForAtLeast(queue, durationMs)
      },
      dispatch: async () => await new DbDispatchPendingAlertEmails(
        dispatchAlerts,
        new BullMqAlertEmailQueue(queue),
        100,
        mode
      ).dispatch(),
      send: send.send.bind(send)
    }), { limiter: ALERT_EMAIL_WORKER_LIMITER })
    await worker.waitUntilReady()
    return new DbDispatchPendingAlertEmails(
      dispatchAlerts,
      new BullMqAlertEmailQueue(queue),
      100,
      mode
    )
  }

  const makeScopedPendingAlertEventsRepository = (
    alertEventId: string
  ): LoadPendingAlertEventsRepository => ({
    loadPendingAlertEventIds: async (afterId, limit, mode) => {
      if (limit <= 0) return []

      const event = await db.selectFrom('alert_events')
        .innerJoin('pages', 'pages.id', 'alert_events.page_id')
        .select([
          'alert_events.id',
          'alert_events.emailed_at',
          'alert_events.previewed_at',
          'alert_events.failed_at',
          'pages.alerts_enabled'
        ])
        .where('alert_events.id', '=', alertEventId)
        .executeTakeFirst()

      if (event === undefined) return []
      if (afterId !== null && event.id <= afterId) return []
      if (event.emailed_at !== null || event.failed_at !== null) return []
      if (!event.alerts_enabled) return []
      if (mode === 'preview' && event.previewed_at !== null) return []

      return [event.id]
    }
  })

  const makePreviewSender = (
    sender: AlertSender
  ): DbSendAlertEmail => new DbSendAlertEmail(
    new PostgresAlertEventRepository(db),
    sender,
    new HmacAlertUnsubscribeToken('integration-secret-'.repeat(3)),
    'Tabstop <alerts@alerts.example.test>',
    'https://app.tabstop.dev',
    'https://api.tabstop.dev',
    'preview'
  )

  it('sends one message when overlapping dispatch runs see the same event', async () => {
    const alertEventId = await seedEvent()
    const sender: AlertSender = { send: vi.fn().mockResolvedValue('accepted') }
    const dispatch = await start(sender, alertEventId)

    await Promise.all([dispatch.dispatch(), dispatch.dispatch()])

    await eventually(async () => {
      const event = await db.selectFrom('alert_events').select('emailed_at')
        .where('id', '=', alertEventId).executeTakeFirstOrThrow()
      expect(event.emailed_at).not.toBeNull()
    })
    expect(sender.send).toHaveBeenCalledOnce()
    expect(await db.selectFrom('alert_events').select('id')
      .where('id', '=', alertEventId).execute()).toHaveLength(1)
  })

  it('retries provider failure against the same event and marks only the accepted attempt', async () => {
    const alertEventId = await seedEvent()
    const sender: AlertSender = {
      send: vi.fn()
        .mockRejectedValueOnce(new Error('provider unavailable'))
        .mockResolvedValue('accepted')
    }
    const dispatch = await start(sender, alertEventId)

    await dispatch.dispatch()

    await eventually(async () => {
      expect(sender.send).toHaveBeenCalledTimes(2)
      const event = await db.selectFrom('alert_events').select('emailed_at')
        .where('id', '=', alertEventId).executeTakeFirstOrThrow()
      expect(event.emailed_at).not.toBeNull()
    })
    expect(await db.selectFrom('alert_events').select('id')
      .where('id', '=', alertEventId).execute()).toHaveLength(1)
  })

  it('pauses provider traffic without consuming a normal job attempt', async () => {
    const alertEventId = await seedEvent()
    const sender: AlertSender = {
      send: vi.fn()
        .mockRejectedValueOnce(new AlertRateLimitError(2_000))
        .mockResolvedValue('accepted')
    }
    const dispatch = await start(sender, alertEventId)

    await dispatch.dispatch()

    await eventually(async () => {
      expect(sender.send).toHaveBeenCalledOnce()
      expect(await queue.getRateLimitTtl(ALERT_EMAIL_WORKER_LIMITER.max))
        .toBeGreaterThan(1_250)
    })

    const paused = await queue.getJob(`alert-email-${alertEventId}`)
    expect(paused?.attemptsMade).toBe(0)

    await new Promise<void>((resolve) => setTimeout(resolve, 250))
    expect(sender.send).toHaveBeenCalledOnce()
    expect((await queue.getJob(`alert-email-${alertEventId}`))?.attemptsMade).toBe(0)

    await eventually(async () => {
      expect(sender.send).toHaveBeenCalledTimes(2)
      expect(await paused?.getState()).toBe('completed')
    })
    expect((await queue.getJob(`alert-email-${alertEventId}`))?.attemptsMade).toBe(1)
  })

  it('does not preview twice after completed-job cleanup, and delivery mode still sends once for the seeded event', async () => {
    const alertEventId = await seedEvent()
    const unrelatedAlertEventId = await seedEvent()
    const previewSender: AlertSender = { send: vi.fn().mockResolvedValue('previewed') }
    const previewDispatch = await start(previewSender, alertEventId, 'preview')

    expect(await previewDispatch.dispatch()).toEqual({ processed: 1 })

    await eventually(async () => {
      expect(previewSender.send).toHaveBeenCalledOnce()
      const event = await db.selectFrom('alert_events')
        .select(['previewed_at', 'emailed_at'])
        .where('id', '=', alertEventId)
        .executeTakeFirstOrThrow()
      expect(event.previewed_at).not.toBeNull()
      expect(event.emailed_at).toBeNull()
    })
    expect(await db.selectFrom('alert_events')
      .select(['previewed_at', 'emailed_at', 'failed_at'])
      .where('id', '=', unrelatedAlertEventId)
      .executeTakeFirstOrThrow()).toEqual({
      previewed_at: null,
      emailed_at: null,
      failed_at: null
    })

    const previewJob = await queue.getJob(`alert-email-${alertEventId}`)
    expect(await previewJob?.getState()).toBe('completed')
    await previewJob?.remove()
    expect(await queue.getJob(`alert-email-${alertEventId}`)).toBeUndefined()

    const redeliveredPreviewJob = await queue.add('send', {
      kind: 'send',
      alertEventId
    }, { jobId: `queued-redelivery-${alertEventId}`, attempts: 1 })

    await eventually(async () => {
      expect(await redeliveredPreviewJob.getState()).toBe('completed')
    })
    expect(previewSender.send).toHaveBeenCalledOnce()
    await redeliveredPreviewJob.remove()

    expect(await previewDispatch.dispatch()).toEqual({ processed: 0 })
    expect(previewSender.send).toHaveBeenCalledOnce()

    await worker?.close()
    worker = null

    const deliverySender: AlertSender = { send: vi.fn().mockResolvedValue('accepted') }
    const deliveryDispatch = await start(deliverySender, alertEventId, 'delivery')

    expect(await deliveryDispatch.dispatch()).toEqual({ processed: 1 })

    await eventually(async () => {
      expect(deliverySender.send).toHaveBeenCalledOnce()
      const event = await db.selectFrom('alert_events')
        .select(['previewed_at', 'emailed_at'])
        .where('id', '=', alertEventId)
        .executeTakeFirstOrThrow()
      expect(event.previewed_at).not.toBeNull()
      expect(event.emailed_at).not.toBeNull()
    })
    expect(await db.selectFrom('alert_events')
      .select(['previewed_at', 'emailed_at', 'failed_at'])
      .where('id', '=', unrelatedAlertEventId)
      .executeTakeFirstOrThrow()).toEqual({
      previewed_at: null,
      emailed_at: null,
      failed_at: null
    })
    expect(previewSender.send).toHaveBeenCalledOnce()
    expect(deliverySender.send).toHaveBeenCalledOnce()
  })

  it('lets only one overlapping worker emit a console preview', async () => {
    const alertEventId = await seedEvent()
    const firstWrite = deferred<'previewed'>()
    const sender: AlertSender = {
      send: vi.fn()
        .mockImplementationOnce(() => firstWrite.promise)
        .mockResolvedValue('previewed')
    }
    const send = makePreviewSender(sender)

    const first = send.send(alertEventId)
    await eventually(async () => {
      expect(sender.send).toHaveBeenCalledOnce()
    })

    const second = send.send(alertEventId)
    await expect(second).resolves.toBe('skipped')
    expect(sender.send).toHaveBeenCalledOnce()

    firstWrite.resolve('previewed')
    await expect(first).resolves.toBe('previewed')
  })

  it('does not repeat a preview whose writer fails after the durable claim', async () => {
    const alertEventId = await seedEvent()
    const sender: AlertSender = {
      send: vi.fn().mockRejectedValue(new Error('preview writer closed'))
    }
    const send = makePreviewSender(sender)

    await expect(send.send(alertEventId)).rejects.toThrow('preview writer closed')
    await expect(send.send(alertEventId)).resolves.toBe('skipped')

    expect(sender.send).toHaveBeenCalledOnce()
    expect(await db.selectFrom('alert_events').select('previewed_at')
      .where('id', '=', alertEventId).executeTakeFirstOrThrow())
      .toEqual({ previewed_at: expect.any(Date) })
  })
})
