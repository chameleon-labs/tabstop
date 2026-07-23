import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { setupApp } from '../config/app.js'

describe('GET /api/health', () => {
  it('returns 200 with an up status', async () => {
    const app = setupApp()

    const response = await request(app).get('/api/health')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ status: 'up' })
    expect(typeof response.body.uptimeInSeconds).toBe('number')
    expect(typeof response.body.checkedAt).toBe('string')
  })
})
