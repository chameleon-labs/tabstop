import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import type { Express } from 'express'
import { setupApp } from '../config/app.js'
import { connectDatabase, disconnectDatabase } from '../config/database.js'
import { RATE_LIMITS } from '../config/rate-limits.js'

const password = 'correct horse battery staple'
const newEmail = (): string => `${randomUUID()}@routes.test`

// signup, login and me are all per-IP rate limited, and the buckets live for
// the whole process. Without a distinct address per test, every plain
// request in this file would share supertest's own loopback address and the
// unrelated tests below would rate-limit each other - signup's capacity of 3
// is exhausted by the third unrelated test that forgets this.
let ipSeq = 0
const uniqueIp = (): string => {
  ipSeq += 1
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`
}

const firstSetCookie = (response: request.Response): string => {
  const header: unknown = response.headers['set-cookie']
  if (!Array.isArray(header) || typeof header[0] !== 'string') {
    throw new Error('expected a set-cookie header')
  }
  return header[0]
}

describe('account routes', () => {
  let app: Express
  let existingAccountEmail: string

  beforeAll(async () => {
    const url = process.env.DATABASE_URL
    if (url === undefined) throw new Error('DATABASE_URL not set by globalSetup')
    connectDatabase(url)
    app = setupApp()

    // Shared by the login rate-limit specs below, which need an account that
    // is known to exist without spending their own signup bucket allowance.
    existingAccountEmail = newEmail()
    await request(app).post('/api/signup').set('x-forwarded-for', uniqueIp())
      .send({ email: existingAccountEmail, password }).expect(201)
  })

  afterAll(async () => {
    await disconnectDatabase()
  })

  describe('POST /api/signup', () => {
    it('returns 201 with the account and an httpOnly session cookie', async () => {
      const email = newEmail()

      const response = await request(app).post('/api/signup')
        .set('x-forwarded-for', uniqueIp()).send({ email, password })

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
      const ip = uniqueIp()
      await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email: `  ${local}@Routes.TEST  `, password }).expect(201)

      const login = await request(app).post('/api/login').set('x-forwarded-for', ip)
        .send({ email: `${local}@routes.test`, password })

      expect(login.status).toBe(200)
      expect(login.body.email).toBe(`${local}@routes.test`)
    })

    it('returns 409 for an email that is already registered', async () => {
      const email = newEmail()
      const ip = uniqueIp()
      await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email, password }).expect(201)

      const response = await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email, password })

      expect(response.status).toBe(409)
      expect(response.body.error).toContain('already registered')
    })

    it('returns 409, never 500, for the loser of a concurrent signup', async () => {
      const email = newEmail()
      const ip = uniqueIp()

      const responses = await Promise.all([
        request(app).post('/api/signup').set('x-forwarded-for', ip).send({ email, password }),
        request(app).post('/api/signup').set('x-forwarded-for', ip).send({ email, password }),
        request(app).post('/api/signup').set('x-forwarded-for', ip).send({ email, password })
      ])

      expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409, 409])
    })

    it('returns 400 for a short password or a malformed email', async () => {
      const ip = uniqueIp()
      const short = await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email: newEmail(), password: 'tooshort' })
      expect(short.status).toBe(400)
      expect(short.body.error).toContain('password')

      const malformed = await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email: 'not-an-email', password })
      expect(malformed.status).toBe(400)
      expect(malformed.body.error).toContain('email')
    })
  })

  describe('POST /api/login', () => {
    it('returns an identical 401 for a wrong password and an unknown email', async () => {
      const email = newEmail()
      const ip = uniqueIp()
      await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email, password }).expect(201)

      const wrongPassword = await request(app).post('/api/login').set('x-forwarded-for', ip)
        .send({ email, password: 'not the right password' })
      const unknownEmail = await request(app).post('/api/login').set('x-forwarded-for', ip)
        .send({ email: newEmail(), password })

      expect(wrongPassword.status).toBe(401)
      expect(unknownEmail.status).toBe(401)
      expect(wrongPassword.body).toEqual(unknownEmail.body)
    })

    it('rejects on the email bucket even when the IP bucket is fresh', async () => {
      // Credential stuffing is many addresses against one account, which a
      // per-IP limit cannot see. Every attempt below comes from a different
      // address, so only the per-email bucket can stop it.
      //
      // A single value, not "x, 203.0.113.1": with one trusted hop, Express
      // takes the LAST entry as the client - appending a fixed trailing
      // address (as the spoofing spec does on purpose) would make every
      // attempt resolve to that same constant address instead of varying it.
      const email = `stuffing-${randomUUID()}@example.com`
      const attempt = async (index: number) => await request(app)
        .post('/api/login')
        .set('x-forwarded-for', `198.51.100.${index + 1}`)
        .send({ email, password: 'wrong-password-entirely' })

      const statuses: number[] = []
      for (let i = 0; i <= RATE_LIMITS.loginEmail.capacity; i++) {
        statuses.push((await attempt(i)).status)
      }

      expect(statuses.at(-1)).toBe(429)
      expect(statuses.slice(0, -1).every((status) => status === 401)).toBe(true)
    })

    it('rate limits an unknown address exactly like a registered one', async () => {
      // The bucket is keyed on the submitted string, never on whether an
      // account exists - otherwise the 429 becomes the account-existence
      // oracle that #10's dummy scrypt verify was written to close.
      //
      // Every call carries its own forwarded address so the per-IP bucket
      // (capacity 10) can never be what rejects: two exhaustions of a
      // capacity-5 email bucket is twelve requests.
      const exhaust = async (email: string) => {
        let last
        for (let i = 0; i <= RATE_LIMITS.loginEmail.capacity; i++) {
          // A single value: with one trusted proxy hop, Express reads the
          // client address from the LAST X-Forwarded-For entry, so this has
          // to be the whole header rather than a prefix in front of a fixed
          // trusted address - otherwise every attempt shares one IP bucket.
          last = await request(app).post('/api/login')
            .set('x-forwarded-for', `192.0.2.${i + 1}`)
            .send({ email, password: 'wrong-password-entirely' })
        }
        if (last === undefined) throw new Error('no request was made')
        return last
      }

      const registered = await exhaust(existingAccountEmail)
      const unknown = await exhaust(`ghost-${randomUUID()}@example.com`)

      expect(registered.status).toBe(429)
      expect(unknown.status).toBe(429)
      // Same error and the same retryAfter - the security-relevant fields. A
      // difference in either would tell an attacker which addresses have
      // accounts. resetAt is excluded from the comparison on purpose: it is
      // derived from wall-clock time at the moment each response is built,
      // and the two exhaust() runs are sequential, so it legitimately differs
      // by however long the first one took - that gap carries no information
      // about account existence.
      expect(unknown.body).toMatchObject({
        error: registered.body.error, retryAfter: registered.body.retryAfter
      })
      expect(typeof (unknown.body as { resetAt: string }).resetAt).toBe('string')
    })
  })

  describe('GET /api/me', () => {
    it('returns 401 without a cookie and the account with one', async () => {
      const email = newEmail()
      const ip = uniqueIp()
      const signup = await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email, password }).expect(201)

      const anonymous = await request(app).get('/api/me').set('x-forwarded-for', ip)
      expect(anonymous.status).toBe(401)

      const authenticated = await request(app).get('/api/me').set('x-forwarded-for', ip)
        .set('Cookie', firstSetCookie(signup))
      expect(authenticated.status).toBe(200)
      expect(authenticated.body.email).toBe(email)
    })

    it('returns 401 for a well-formed but unknown session id', async () => {
      const response = await request(app).get('/api/me').set('x-forwarded-for', uniqueIp())
        .set('Cookie', `sid=${'a'.repeat(64)}`)

      expect(response.status).toBe(401)
    })
  })

  describe('POST /api/logout', () => {
    it('revokes the session, so the same cookie stops working', async () => {
      const ip = uniqueIp()
      const signup = await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email: newEmail(), password }).expect(201)
      const cookie = firstSetCookie(signup)
      await request(app).get('/api/me').set('x-forwarded-for', ip).set('Cookie', cookie).expect(200)

      // logout is deliberately unrated - no x-forwarded-for needed.
      const logout = await request(app).post('/api/logout').set('Cookie', cookie)
      expect(logout.status).toBe(204)

      // The assertion that proves revocation is real rather than cosmetic: the
      // client still holds the cookie, and it is now worthless.
      const after = await request(app).get('/api/me').set('x-forwarded-for', ip).set('Cookie', cookie)
      expect(after.status).toBe(401)
    })

    it('is idempotent without a cookie or with an unknown session', async () => {
      // logout is deliberately unrated - no x-forwarded-for needed.
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

  describe('CSRF', () => {
    it('rejects a state-changing request from another origin', async () => {
      // SameSite=Lax does not help here: this design puts the app and the API
      // under one registrable domain, so a page on a sibling host is same-site
      // and its form POST would carry the session cookie.
      const ip = uniqueIp()
      const signup = await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email: newEmail(), password }).expect(201)
      const cookie = firstSetCookie(signup)

      // logout is deliberately unrated - no x-forwarded-for needed.
      const forced = await request(app).post('/api/logout')
        .set('Cookie', cookie)
        .set('Origin', 'https://evil.tabstop.dev')

      expect(forced.status).toBe(403)

      // and the session was NOT revoked
      await request(app).get('/api/me').set('x-forwarded-for', ip).set('Cookie', cookie).expect(200)
    })

    it('allows a state-changing request from the configured frontend origin', async () => {
      const signup = await request(app).post('/api/signup').set('x-forwarded-for', uniqueIp())
        .send({ email: newEmail(), password }).expect(201)

      // logout is deliberately unrated - no x-forwarded-for needed.
      await request(app).post('/api/logout')
        .set('Cookie', firstSetCookie(signup))
        .set('Origin', 'http://localhost:5173')
        .expect(204)
    })

    it('allows a request with no Origin at all, which no browser CSRF can be', async () => {
      // logout is deliberately unrated - no x-forwarded-for needed.
      await request(app).post('/api/logout').expect(204)
    })

    it('does not interfere with reads', async () => {
      await request(app).get('/api/me').set('x-forwarded-for', uniqueIp())
        .set('Origin', 'https://evil.tabstop.dev').expect(401)
    })
  })

  describe('caching', () => {
    it('marks authenticated responses no-store', async () => {
      // GET /api/me returns per-user data. A 200 with no Cache-Control is
      // heuristically cacheable, and the only thing a shared cache in front of
      // the API could vary on is the session cookie - so without this, a CDN
      // could serve one user's identity to another.
      const ip = uniqueIp()
      const signup = await request(app).post('/api/signup').set('x-forwarded-for', ip)
        .send({ email: newEmail(), password }).expect(201)

      const me = await request(app).get('/api/me').set('x-forwarded-for', ip)
        .set('Cookie', firstSetCookie(signup))

      expect(me.status).toBe(200)
      expect(me.headers['cache-control']).toBe('no-store')
    })
  })
})
