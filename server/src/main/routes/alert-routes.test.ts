import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { setupApp } from '../config/app.js'
import { connectDatabase, disconnectDatabase, getDatabase } from '../config/database.js'
import { env } from '../config/env.js'
import { HmacAlertUnsubscribeToken } from '../../infra/cryptography/hmac-alert-unsubscribe-token.js'
import { closeRateLimiter } from '../factories/middlewares/rate-limit-factory.js'

describe('page alert unsubscribe routes', () => {
  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    connectDatabase(url)
  })

  afterAll(async () => {
    await disconnectDatabase()
    await closeRateLimiter()
  })

  const seedPage = async (): Promise<string> => {
    const db = getDatabase()
    const user = await db.insertInto('users').values({
      email: `${randomUUID()}@test.test`,
      password_digest: 'x'
    }).returning('id').executeTakeFirstOrThrow()
    const site = await db.insertInto('sites').values({
      user_id: user.id,
      domain: `${randomUUID()}.test`
    }).returning('id').executeTakeFirstOrThrow()
    return (await db.insertInto('pages').values({
      site_id: site.id,
      url: `https://${randomUUID()}.test/page`
    }).returning('id').executeTakeFirstOrThrow()).id
  }

  it('shows a confirmation without changing either page preference', async () => {
    const pageId = await seedPage()
    const token = new HmacAlertUnsubscribeToken(env.alertUnsubscribeSecret).encode(pageId)

    const response = await request(setupApp())
      .get(`/api/alerts/unsubscribe/${token}`)
      .set('x-forwarded-for', '172.22.0.1')

    expect(response.status).toBe(200)
    expect(response.type).toBe('text/html')
    expect(response.text).toContain('Stop alerts for this page?')
    expect(await getDatabase().selectFrom('pages')
      .select(['alerts_enabled', 'monitoring_enabled'])
      .where('id', '=', pageId).executeTakeFirstOrThrow())
      .toEqual({ alerts_enabled: true, monitoring_enabled: true })
  })

  it('accepts RFC 8058 one-click POST without a session and keeps monitoring on', async () => {
    const pageId = await seedPage()
    const token = new HmacAlertUnsubscribeToken(env.alertUnsubscribeSecret).encode(pageId)

    const response = await request(setupApp())
      .post(`/api/alerts/unsubscribe/${token}`)
      .set('x-forwarded-for', '172.22.0.2')
      .type('form')
      .send({ 'List-Unsubscribe': 'One-Click' })

    expect(response.status).toBe(200)
    expect(response.text).toContain('Alerts are off')
    expect(await getDatabase().selectFrom('pages')
      .select(['alerts_enabled', 'monitoring_enabled'])
      .where('id', '=', pageId).executeTakeFirstOrThrow())
      .toEqual({ alerts_enabled: false, monitoring_enabled: true })
  })

  it('accepts the confirmation form posted from the API origin that served it', async () => {
    const pageId = await seedPage()
    const token = new HmacAlertUnsubscribeToken(env.alertUnsubscribeSecret).encode(pageId)

    const response = await request(setupApp())
      .post(`/api/alerts/unsubscribe/${token}`)
      .set('Origin', env.publicApiOrigin)
      .set('x-forwarded-for', '172.22.0.4')
      .type('form')
      .send({ 'List-Unsubscribe': 'One-Click' })

    expect(response.status).toBe(200)
    expect(await getDatabase().selectFrom('pages').select('alerts_enabled')
      .where('id', '=', pageId).executeTakeFirstOrThrow())
      .toEqual({ alerts_enabled: false })
  })

  it('rejects a tampered token without changing the page', async () => {
    const pageId = await seedPage()
    const token = new HmacAlertUnsubscribeToken(env.alertUnsubscribeSecret).encode(pageId)
    const tampered = token.replace(`v1.${pageId}.`, `v1.${BigInt(pageId) + 1n}.`)

    const response = await request(setupApp())
      .post(`/api/alerts/unsubscribe/${tampered}`)
      .set('x-forwarded-for', '172.22.0.3')
      .type('form')
      .send({ 'List-Unsubscribe': 'One-Click' })

    expect(response.status).toBe(404)
    expect(await getDatabase().selectFrom('pages').select('alerts_enabled')
      .where('id', '=', pageId).executeTakeFirstOrThrow())
      .toEqual({ alerts_enabled: true })
  })
})
