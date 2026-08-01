import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { setupApp } from '../config/app.js'
import { connectDatabase, disconnectDatabase } from '../config/database.js'
import { makeTestAppDependencies } from '../test/test-app-dependencies.js'

describe('GET /api/health', () => {
  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    connectDatabase(url)
  })

  afterAll(async () => {
    await disconnectDatabase()
  })

  it('returns 200 with an up status and a reachable database', async () => {
    const dependencies = makeTestAppDependencies()
    const app = setupApp(dependencies)

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'up', database: 'up' })
    expect(typeof response.body.uptimeInSeconds).toBe('number')
    expect(typeof response.body.checkedAt).toBe('string')
  })
})
