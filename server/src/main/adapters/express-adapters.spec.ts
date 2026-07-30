import { describe, expect, it } from 'vitest'
import request from 'supertest'
import express from 'express'
import { adaptRoute } from './express-route-adapter.js'
import { adaptMiddleware } from './express-middleware-adapter.js'
import type { Controller } from '../../presentation/protocols/controller.js'
import type { Middleware } from '../../presentation/protocols/middleware.js'
import type { HttpResponse } from '../../presentation/protocols/http.js'

// noUncheckedIndexedAccess makes headers['set-cookie'][0] a type error.
const firstSetCookie = (response: request.Response): string => {
  const header: unknown = response.headers['set-cookie']
  if (!Array.isArray(header) || typeof header[0] !== 'string') {
    throw new Error('expected a set-cookie header')
  }
  return header[0]
}

const makeApp = (controller: Controller, middleware?: Middleware): express.Express => {
  const app = express()
  app.use(express.json())
  if (middleware !== undefined) {
    app.post('/probe', adaptMiddleware(middleware), adaptRoute(controller))
  } else {
    app.post('/probe', adaptRoute(controller))
  }
  return app
}

const echoController: Controller = {
  async handle (httpRequest: unknown): Promise<HttpResponse> {
    return { statusCode: 200, body: httpRequest }
  }
}

describe('adaptRoute', () => {
  it('applies the security attributes the adapter owns, not the controller', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000)
    const controller: Controller = {
      async handle (): Promise<HttpResponse> {
        return {
          statusCode: 201,
          body: { ok: true },
          cookies: [{ action: 'set', name: 'sid', value: 'deadbeef', expiresAt }]
        }
      }
    }

    const response = await request(makeApp(controller)).post('/probe').send({})
    const cookie = firstSetCookie(response)

    expect(response.status).toBe(201)
    expect(cookie).toContain('sid=deadbeef')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    // Host-only: a compromised sibling subdomain must never receive it.
    expect(cookie).not.toContain('Domain')
  })

  it('clears a cookie', async () => {
    const controller: Controller = {
      async handle (): Promise<HttpResponse> {
        return { statusCode: 204, body: null, cookies: [{ action: 'clear', name: 'sid' }] }
      }
    }

    const cookie = firstSetCookie(await request(makeApp(controller)).post('/probe').send({}))

    expect(cookie).toContain('sid=;')
  })

  it('hands the controller the parsed cookies, so logout needs no middleware', async () => {
    const response = await request(makeApp(echoController))
      .post('/probe').set('Cookie', 'sid=abc123').send({})

    expect(response.body.cookies).toEqual({ sid: 'abc123' })
  })

  it('overrides a cookies field supplied in the body', async () => {
    const response = await request(makeApp(echoController))
      .post('/probe').set('Cookie', 'sid=real').send({ cookies: { sid: 'forged' } })

    expect(response.body.cookies).toEqual({ sid: 'real' })
  })

  it('lets res.locals outrank a client trying to spoof userId in the body', async () => {
    // If res.locals were merged before req.body, a client would post
    // {"userId": ...} and impersonate. Mutation-check by reordering the spread.
    const middleware: Middleware = {
      async handle (): Promise<HttpResponse> {
        return { statusCode: 200, body: { userId: 'from-session' } }
      }
    }

    const response = await request(makeApp(echoController, middleware))
      .post('/probe').send({ userId: 'spoofed-by-client', other: 'kept' })

    expect(response.body.userId).toBe('from-session')
    expect(response.body.other).toBe('kept')
  })

  it('lets a path parameter outrank a query string of the same name', async () => {
    // Both are client-supplied, so neither can spoof a session - but they are
    // not interchangeable. A path segment is what the route matched and what a
    // cache keys on; a query string is an extra the client appended. With the
    // query spread last, `GET /api/audits/<uuid>?uuid=<other>` is answered
    // from <other> while the cached url still says <uuid>.
    const app = express()
    app.use(express.json())
    app.get('/probe/:id', adaptRoute(echoController))

    const response = await request(app).get('/probe/from-path?id=from-query')

    expect(response.body.id).toBe('from-path')
  })
})

describe('adaptMiddleware', () => {
  it('stops the request when the middleware rejects it', async () => {
    const middleware: Middleware = {
      async handle (): Promise<HttpResponse> {
        return { statusCode: 401, body: { error: 'Unauthorized' } }
      }
    }

    const response = await request(makeApp(echoController, middleware)).post('/probe').send({})

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ error: 'Unauthorized' })
  })

  it('hands the middleware the parsed cookies', async () => {
    let seen: Record<string, string> | null = null
    const middleware: Middleware = {
      async handle (middlewareRequest): Promise<HttpResponse> {
        seen = middlewareRequest.cookies
        return { statusCode: 200, body: {} }
      }
    }

    await request(makeApp(echoController, middleware))
      .post('/probe').set('Cookie', 'sid=abc123; junk=x').send({})

    expect(seen).toEqual({ sid: 'abc123', junk: 'x' })
  })

  it('applies headers a controller asked for, overriding a middleware default', async () => {
    // The no-store middleware runs before the route, so a controller opting
    // into caching has to be able to win - otherwise an immutable public
    // result could never be cached at all.
    const controller: Controller = {
      async handle (): Promise<HttpResponse> {
        return {
          statusCode: 200,
          body: { ok: true },
          headers: { 'cache-control': 'public, max-age=3600' }
        }
      }
    }
    const app = express()
    app.use((_req, res, next) => { res.set('cache-control', 'no-store'); next() })
    app.post('/probe', adaptRoute(controller))

    const response = await request(app).post('/probe').send({})

    expect(response.headers['cache-control']).toBe('public, max-age=3600')
  })

  it('refuses header names a controller has no business setting', async () => {
    // Forwarding arbitrary names would undo the boundary this adapter holds: a
    // controller could emit its own set-cookie without the security
    // attributes, or rewrite the CORS headers the middleware just set.
    const controller: Controller = {
      async handle (): Promise<HttpResponse> {
        return {
          statusCode: 200,
          body: {},
          headers: {
            'set-cookie': 'sid=stolen',
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=60'
          }
        }
      }
    }
    const app = express()
    app.use((_req, res, next) => {
      res.set('access-control-allow-origin', 'https://app.example.com')
      next()
    })
    app.post('/probe', adaptRoute(controller))

    const response = await request(app).post('/probe').send({})

    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com')
    // The one thing a controller does legitimately own still works.
    expect(response.headers['cache-control']).toBe('public, max-age=60')
  })

  it('adds to Vary rather than replacing what the middleware stack declared', async () => {
    // Vary is a LIST, and cors.ts appends `origin` to it with a comment saying
    // that overwriting would drop a variant added elsewhere. This adapter WAS
    // that elsewhere: it applied every controller header with res.set, so a
    // controller asking to vary on Cookie silently removed Origin from the
    // cache key - and a credentialed CORS response cached without varying on
    // Origin is one that can be served to the wrong origin.
    const controller: Controller = {
      async handle (): Promise<HttpResponse> {
        return { statusCode: 200, body: {}, headers: { vary: 'Cookie' } }
      }
    }
    const app = express()
    app.use((_req, res, next) => { res.append('vary', 'origin'); next() })
    app.post('/probe', adaptRoute(controller))

    const response = await request(app).post('/probe').send({})

    const vary = response.headers.vary ?? ''
    expect(vary).toContain('origin')
    expect(vary).toContain('Cookie')
  })

  it('still lets a controller replace cache-control outright', async () => {
    // The counterpart to the rule above, and why the adapter cannot simply
    // append everything: cache-control is a single directive set rather than a
    // list, so a controller opting into caching has to BEAT the global
    // no-store, not accumulate alongside it.
    const controller: Controller = {
      async handle (): Promise<HttpResponse> {
        return {
          statusCode: 200, body: {}, headers: { 'cache-control': 'private, max-age=60' }
        }
      }
    }
    const app = express()
    app.use((_req, res, next) => { res.set('cache-control', 'no-store'); next() })
    app.post('/probe', adaptRoute(controller))

    expect((await request(app).post('/probe').send({})).headers['cache-control'])
      .toBe('private, max-age=60')
  })

  it('leaves the default alone when a controller asks for nothing', async () => {
    const app = express()
    app.use((_req, res, next) => { res.set('cache-control', 'no-store'); next() })
    app.post('/probe', adaptRoute(echoController))

    expect((await request(app).post('/probe').send({})).headers['cache-control'])
      .toBe('no-store')
  })
})
