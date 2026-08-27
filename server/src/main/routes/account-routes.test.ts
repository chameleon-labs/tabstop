import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import type {Express} from 'express';
import {setupApp} from '../config/app.js';
import {connectDatabase, disconnectDatabase} from '../config/database.js';
import {RATE_LIMITS} from '../config/rate-limits.js';
import {makeTestAppDependencies} from '../test/test-app-dependencies.js';

const password = 'correct horse battery staple';
const newEmail = (): string => `${randomUUID()}@routes.test`;

let ipSeq = 0;
const uniqueIp = (): string => {
  ipSeq += 1;
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
};

const firstSetCookie = (response: request.Response): string => {
  const header: unknown = response.headers['set-cookie'];
  if (!Array.isArray(header) || typeof header[0] !== 'string') {
    throw new Error('expected a set-cookie header');
  }
  return header[0];
};

describe('account routes', () => {
  let app: Express;
  let existingAccountEmail: string;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    connectDatabase(url);
    const dependencies = makeTestAppDependencies();
    app = setupApp(dependencies);

    existingAccountEmail = newEmail();
    await request(app)
      .post('/api/signup')
      .set('x-forwarded-for', uniqueIp())
      .send({email: existingAccountEmail, password})
      .expect(201);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('does not share the me quota between independently constructed apps', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      const first = setupApp(makeTestAppDependencies());
      const second = setupApp(makeTestAppDependencies());
      const isolatedIp = '198.51.100.57';

      for (let attempt = 0; attempt < RATE_LIMITS.me.capacity; attempt++) {
        await request(first).get('/api/me').set('X-Forwarded-For', isolatedIp);
      }

      expect((await request(first).get('/api/me').set('X-Forwarded-For', isolatedIp)).status).toBe(429);
      expect((await request(second).get('/api/me').set('X-Forwarded-For', isolatedIp)).status).toBe(401);
    } finally {
      now.mockRestore();
    }
  });

  describe('POST /api/signup', () => {
    it('returns 201 with the account and an httpOnly session cookie', async () => {
      const email = newEmail();

      const response = await request(app)
        .post('/api/signup')
        .set('x-forwarded-for', uniqueIp())
        .send({email, password});

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: expect.any(String),
        email,
        alertThreshold: 5,
      });
      const cookie = firstSetCookie(response);
      expect(cookie).toMatch(/^sid=[0-9a-f]{64};/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('normalises email case and whitespace through the whole stack', async () => {
      const local = randomUUID();
      const ip = uniqueIp();
      await request(app)
        .post('/api/signup')
        .set('x-forwarded-for', ip)
        .send({email: `  ${local}@Routes.TEST  `, password})
        .expect(201);

      const login = await request(app)
        .post('/api/login')
        .set('x-forwarded-for', ip)
        .send({email: `${local}@routes.test`, password});

      expect(login.status).toBe(200);
      expect(login.body.email).toBe(`${local}@routes.test`);
    });

    it('returns 409 for an email that is already registered', async () => {
      const email = newEmail();
      const ip = uniqueIp();
      await request(app).post('/api/signup').set('x-forwarded-for', ip).send({email, password}).expect(201);

      const response = await request(app).post('/api/signup').set('x-forwarded-for', ip).send({email, password});

      expect(response.status).toBe(409);
      expect(response.body.error).toContain('already registered');
    });

    it('returns 409, never 500, for the loser of a concurrent signup', async () => {
      const email = newEmail();

      const responses = await Promise.all([
        request(app).post('/api/signup').set('x-forwarded-for', uniqueIp()).send({email, password}),
        request(app).post('/api/signup').set('x-forwarded-for', uniqueIp()).send({email, password}),
        request(app).post('/api/signup').set('x-forwarded-for', uniqueIp()).send({email, password}),
      ]);

      expect(responses.map((r) => r.status).toSorted((a, b) => a - b)).toEqual([201, 409, 409]);
    });

    it('returns 400 for a short password or a malformed email', async () => {
      const ip = uniqueIp();
      const short = await request(app)
        .post('/api/signup')
        .set('x-forwarded-for', ip)
        .send({email: newEmail(), password: 'tooshort'});
      expect(short.status).toBe(400);
      expect(short.body.error).toContain('password');

      const malformed = await request(app)
        .post('/api/signup')
        .set('x-forwarded-for', ip)
        .send({email: 'not-an-email', password});
      expect(malformed.status).toBe(400);
      expect(malformed.body.error).toContain('email');
    });
  });

  describe('POST /api/login', () => {
    it('returns an identical 401 for a wrong password and an unknown email', async () => {
      const email = newEmail();
      const ip = uniqueIp();
      await request(app).post('/api/signup').set('x-forwarded-for', ip).send({email, password}).expect(201);

      const wrongPassword = await request(app)
        .post('/api/login')
        .set('x-forwarded-for', ip)
        .send({email, password: 'not the right password'});
      const unknownEmail = await request(app)
        .post('/api/login')
        .set('x-forwarded-for', ip)
        .send({email: newEmail(), password});

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });

    it('rejects on the email bucket even when the IP bucket is fresh', async () => {
      const email = `stuffing-${randomUUID()}@example.com`;
      const attempt = async (index: number) =>
        await request(app)
          .post('/api/login')
          .set('x-forwarded-for', `198.51.100.${index + 1}`)
          .send({email, password: 'wrong-password-entirely'});

      const statuses: number[] = [];
      for (let i = 0; i <= RATE_LIMITS.loginEmail.capacity; i++) {
        statuses.push((await attempt(i)).status);
      }

      expect(statuses.at(-1)).toBe(429);
      expect(statuses.slice(0, -1).every((status) => status === 401)).toBe(true);
    });

    it('rate limits an unknown address exactly like a registered one', async () => {
      const exhaust = async (email: string) => {
        let last;
        for (let i = 0; i <= RATE_LIMITS.loginEmail.capacity; i++) {
          last = await request(app)
            .post('/api/login')
            .set('x-forwarded-for', `192.0.2.${i + 1}`)
            .send({email, password: 'wrong-password-entirely'});
        }
        if (last === undefined) {
          throw new Error('no request was made');
        }
        return last;
      };

      const registered = await exhaust(existingAccountEmail);
      const unknown = await exhaust(`ghost-${randomUUID()}@example.com`);

      expect(registered.status).toBe(429);
      expect(unknown.status).toBe(429);

      const {retryAfter: unknownRetry, resetAt: unknownResetAt, ...unknownRest} = unknown.body;
      const {retryAfter: knownRetry, resetAt: knownResetAt, ...knownRest} = registered.body;

      expect(unknownRest).toEqual(knownRest);
      expect(Math.abs(unknownRetry - knownRetry)).toBeLessThanOrEqual(1);
      expect(typeof unknownResetAt).toBe('string');
      expect(typeof knownResetAt).toBe('string');
    });
  });

  describe('GET /api/me', () => {
    it('returns 401 without a cookie and the account with one', async () => {
      const email = newEmail();
      const ip = uniqueIp();
      const signup = await request(app)
        .post('/api/signup')
        .set('x-forwarded-for', ip)
        .send({email, password})
        .expect(201);

      const anonymous = await request(app).get('/api/me').set('x-forwarded-for', ip);
      expect(anonymous.status).toBe(401);

      const authenticated = await request(app)
        .get('/api/me')
        .set('x-forwarded-for', ip)
        .set('Cookie', firstSetCookie(signup));
      expect(authenticated.status).toBe(200);
      expect(authenticated.body.email).toBe(email);
    });

    it('returns 401 for a well-formed but unknown session id', async () => {
      const response = await request(app)
        .get('/api/me')
        .set('x-forwarded-for', uniqueIp())
        .set('Cookie', `sid=${'a'.repeat(64)}`);

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/logout', () => {
    it('revokes the session, so the same cookie stops working', async () => {
      const ip = uniqueIp();
      const signup = await request(app)
        .post('/api/signup')
        .set('x-forwarded-for', ip)
        .send({email: newEmail(), password})
        .expect(201);
      const cookie = firstSetCookie(signup);
      await request(app).get('/api/me').set('x-forwarded-for', ip).set('Cookie', cookie).expect(200);

      const logout = await request(app).post('/api/logout').set('x-forwarded-for', ip).set('Cookie', cookie);
      expect(logout.status).toBe(204);

      const after = await request(app).get('/api/me').set('x-forwarded-for', ip).set('Cookie', cookie);
      expect(after.status).toBe(401);
    });

    it('is idempotent without a cookie or with an unknown session', async () => {
      const ip = uniqueIp();
      await request(app).post('/api/logout').set('x-forwarded-for', ip).expect(204);
      await request(app)
        .post('/api/logout')
        .set('x-forwarded-for', ip)
        .set('Cookie', `sid=${'b'.repeat(64)}`)
        .expect(204);
    });

    it('stays idempotent right up to the limit, then answers 429', async () => {
      const ip = uniqueIp();
      const logout = async () => await request(app).post('/api/logout').set('x-forwarded-for', ip);

      const statuses: number[] = [];
      for (let i = 0; i <= RATE_LIMITS.logout.capacity; i++) {
        statuses.push((await logout()).status);
      }

      expect(statuses.slice(0, -1).every((status) => status === 204)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    });
  });

  describe('CORS', () => {
    it('sends credentialed headers and never a wildcard', async () => {
      const response = await request(app).get('/api/health');

      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(response.headers.vary).toBe('origin');
      expect(response.headers['access-control-allow-headers']).toBe('content-type');
    });
  });

  describe('CSRF', () => {
    it('rejects a state-changing request from another origin', async () => {
      const ip = uniqueIp();
      const signup = await request(app)
        .post('/api/signup')
        .set('x-forwarded-for', ip)
        .send({email: newEmail(), password})
        .expect(201);
      const cookie = firstSetCookie(signup);

      const forced = await request(app)
        .post('/api/logout')
        .set('x-forwarded-for', ip)
        .set('Cookie', cookie)
        .set('Origin', 'https://evil.tabstop.dev');

      expect(forced.status).toBe(403);

      await request(app).get('/api/me').set('x-forwarded-for', ip).set('Cookie', cookie).expect(200);
    });

    it('allows a state-changing request from the configured frontend origin', async () => {
      const signup = await request(app)
        .post('/api/signup')
        .set('x-forwarded-for', uniqueIp())
        .send({email: newEmail(), password})
        .expect(201);

      await request(app)
        .post('/api/logout')
        .set('x-forwarded-for', uniqueIp())
        .set('Cookie', firstSetCookie(signup))
        .set('Origin', 'http://localhost:5173')
        .expect(204);
    });

    it('allows a request with no Origin at all, which no browser CSRF can be', async () => {
      await request(app).post('/api/logout').set('x-forwarded-for', uniqueIp()).expect(204);
    });

    it('does not interfere with reads', async () => {
      await request(app)
        .get('/api/me')
        .set('x-forwarded-for', uniqueIp())
        .set('Origin', 'https://evil.tabstop.dev')
        .expect(401);
    });
  });

  describe('caching', () => {
    it('marks authenticated responses no-store', async () => {
      const ip = uniqueIp();
      const signup = await request(app)
        .post('/api/signup')
        .set('x-forwarded-for', ip)
        .send({email: newEmail(), password})
        .expect(201);

      const me = await request(app).get('/api/me').set('x-forwarded-for', ip).set('Cookie', firstSetCookie(signup));

      expect(me.status).toBe(200);
      expect(me.headers['cache-control']).toBe('no-store');
    });
  });
});
