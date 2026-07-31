import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kysely } from 'kysely'
import { DbDispatchPendingAlertEmails } from '../../data/usecases/alert/dispatch-pending-alert-emails.js'
import { DbSendAlertEmail } from '../../data/usecases/alert/send-alert-email.js'
import type {
  LoadPendingAlertEventsRepository
} from '../../data/protocols/db/alert-event/load-pending-alert-events-repository.js'
import type { AlertSender } from '../../data/protocols/mail/alert-sender.js'
import type { Database } from '../../infra/db/postgres/database.js'
import {
  PostgresAlertEventRepository
} from '../../infra/db/postgres/alert-event/postgres-alert-event-repository.js'
import {
  PostgresAuditRepository
} from '../../infra/db/postgres/audit/postgres-audit-repository.js'
import { makeDatabase } from '../../infra/db/postgres/helpers/postgres-helper.js'
import { BullMqAlertEmailQueue } from '../../infra/queue/bullmq-alert-email-queue.js'
import {
  makeQueue, makeWorker, type PayloadQueue, type PayloadWorker
} from '../../infra/queue/helpers/bullmq-helper.js'
import { HmacAlertUnsubscribeToken } from '../../infra/cryptography/hmac-alert-unsubscribe-token.js'
import type { AlertQueuePayload } from '../config/queue-names.js'

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
  })

  afterEach(async () => {
    if (worker !== null) await worker.close()
    await queue.obliterate({ force: true })
    await queue.close()
    await db.destroy()
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
    await db.insertInto('audits').values({
      page_id: page.id,
      url: 'https://example.test/checkout',
      status: 'done',
      score: 90,
      axe_version: '4.12.1'
    }).execute()
    const current = await db.insertInto('audits').values({
      page_id: page.id,
      url: 'https://example.test/checkout',
      status: 'queued'
    }).returning('id').executeTakeFirstOrThrow()
    const audits = new PostgresAuditRepository(db)
    const claimedAt = await audits.claimForRun(current.id)
    if (claimedAt === null) throw new Error('fixture could not claim its audit')
    await audits.complete(current.id, claimedAt, {
      score: 80,
      countsByImpact: { minor: 0, moderate: 0, serious: 0, critical: 0 },
      axeVersion: '4.12.1',
      durationMs: 10,
      settled: true,
      violations: []
    })

    return (await db.selectFrom('alert_events').select('id')
      .where('audit_id', '=', current.id).executeTakeFirstOrThrow()).id
  }

  const start = async (sender: AlertSender, alertEventId: string) => {
    const redisUrl = process.env.REDIS_URL
    if (redisUrl === undefined) throw new Error('REDIS_URL not set by globalSetup')
    const repository = new PostgresAlertEventRepository(db)
    const send = new DbSendAlertEmail(
      repository,
      sender,
      new HmacAlertUnsubscribeToken('integration-secret-'.repeat(3)),
      'Tabstop <alerts@alerts.example.test>',
      'https://app.tabstop.dev',
      'https://api.tabstop.dev'
    )
    worker = makeWorker<AlertQueuePayload>(queue.name, redisUrl, async (job) => {
      if (job.data.kind === 'send') await send.send(job.data.alertEventId)
    })
    await worker.waitUntilReady()

    const pending: LoadPendingAlertEventsRepository = {
      loadPendingAlertEventIds: vi.fn(async (afterId: string | null) =>
        afterId === null ? [alertEventId] : [])
    }
    return new DbDispatchPendingAlertEmails(pending, new BullMqAlertEmailQueue(queue))
  }

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
})
