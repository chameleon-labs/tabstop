import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import type { Express } from 'express'
import { setupApp } from '../config/app.js'
import { connectDatabase, disconnectDatabase } from '../config/database.js'

const password = 'correct horse battery staple'
const newEmail = (): string => `${randomUUID()}@routes.test`

const firstSetCookie = (response: request.Response): string => {
  const header: unknown = response.headers['set-cookie']
  if (!Array.isArray(header) || typeof header[0] !== 'string') {
    throw new Error('expected a set-cookie header')
  }
  return header[0]
}

describe('account routes', () => {
  let app: Express

  beforeAll(() => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    connectDatabase(url)
    app = setupApp()
  })

  afterAll(async () => {
    await disconnectDatabase()
  })

  describe('POST /api/signup', () => {
    it('returns 201 with the account and an httpOnly session cookie', async () => {
      const email = newEmail()

      const response = await request(app).post('/api/signup').send({ email, password })

      expect(response.status).toBe(201)
      expect(response.body).toEqual({
        id: expect.any(String), email, alertThreshold: 5
      })
      const cookie = firstSetCookie(response)
      expect(cookie).toMatch(/^sid=[0-9a-f]{64};/)
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('SameSite=Lax')
    })

    it('normalises email case and whitespace through the whole stack', async () => {
      const local = randomUUID()
      await request(app).post('/api/signup')
        .send({ email: `  ${local}@Routes.TEST  `, password }).expect(201)

      const login = await request(app).post('/api/login')
        .send({ email: `${local}@routes.test`, password })

      expect(login.status).toBe(200)
      expect(login.body.email).toBe(`${local}@routes.test`)
    })

    it('returns 409 for an email that is already registered', async () => {
      const email = newEmail()
      await request(app).post('/api/signup').send({ email, password }).expect(201)

      const response = await request(app).post('/api/signup').send({ email, password })

      expect(response.status).toBe(409)
      expect(response.body.error).toContain('already registered')
    })

    it('returns 409, never 500, for the loser of a concurrent signup', async () => {
      const email = newEmail()

      const responses = await Promise.all([
        request(app).post('/api/signup').send({ email, password }),
        request(app).post('/api/signup').send({ email, password }),
        request(app).post('/api/signup').send({ email, password })
      ])

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409])
    })

    it('returns 400 for a short password or a malformed email', async () => {
      const short = await request(app).post('/api/signup')
        .send({ email: newEmail(), password: 'tooshort' })
      expect(short.status).toBe(400)
      expect(short.body.error).toContain('password')

      const malformed = await request(app).post('/api/signup')
        .send({ email: 'not-an-email', password })
      expect(malformed.status).toBe(400)
      expect(malformed.body.error).toContain('email')
    })
  })

  describe('POST /api/login', () => {
    it('returns an identical 401 for a wrong password and an unknown email', async () => {
      const email = newEmail()
      await request(app).post('/api/signup').send({ email, password }).expect(201)

      const wrongPassword = await request(app).post('/api/login')
        .send({ email, password: 'not the right password' })
      const unknownEmail = await request(app).post('/api/login')
        .send({ email: newEmail(), password })

      expect(wrongPassword.status).toBe(401)
      expect(unknownEmail.status).toBe(401)
      expect(wrongPassword.body).toEqual(unknownEmail.body)
    })
  })

  describe('GET /api/me', () => {
    it('returns 401 without a cookie and the account with one', async () => {
      const email = newEmail()
      const signup = await request(app).post('/api/signup').send({ email, password }).expect(201)

      const anonymous = await request(app).get('/api/me')
      expect(anonymous.status).toBe(401)

      const authenticated = await request(app).get('/api/me')
        .set('Cookie', firstSetCookie(signup))
      expect(authenticated.status).toBe(200)
      expect(authenticated.body.email).toBe(email)
    })

    it('returns 401 for a well-formed but unknown session id', async () => {
      const response = await request(app).get('/api/me').set('Cookie', `sid=${'a'.repeat(64)}`)

      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/logout', () => {
    it('revokes the session, so the same cookie stops working', async () => {
      const signup = await request(app).post('/api/signup')
        .send({ email: newEmail(), password }).expect(201)
      const cookie = firstSetCookie(signup)
      await request(app).get('/api/me').set('Cookie', cookie).expect(200)

      const logout = await request(app).post('/api/logout').set('Cookie', cookie)
      expect(logout.status).toBe(204)

      // The assertion that proves revocation is real rather than cosmetic: the
      // client still holds the cookie, and it is now worthless.
      const after = await request(app).get('/api/me').set('Cookie', cookie)
      expect(after.status).toBe(401)
    })

    it('is idempotent without a cookie or with an unknown session', async () => {
      await request(app).post('/api/logout').expect(204)
      await request(app).post('/api/logout').set('Cookie', `sid=${'b'.repeat(64)}`).expect(204)
    })
  })

  describe('CORS', () => {
    it('sends credentialed headers and never a wildcard', async () => {
      // `*` is invalid on a credentialed request - for the origin and for the
      // allowed headers alike - so both are stated exactly.
      const response = await request(app).get('/api/health')

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173')
      expect(response.headers['access-control-allow-credentials']).toBe('true')
      expect(response.headers.vary).toBe('origin')
      expect(response.headers['access-control-allow-headers']).toBe('content-type')
    })
  })
})
