import {describe, expect, it} from 'vitest';
import request from 'supertest';
import express from 'express';
import {adaptRoute} from './express-route-adapter.js';
import {adaptMiddleware} from './express-middleware-adapter.js';
import type {Controller} from '../../presentation/protocols/controller.js';
import type {Middleware} from '../../presentation/protocols/middleware.js';
import type {HttpResponse} from '../../presentation/protocols/http.js';

const firstSetCookie = (response: request.Response): string => {
  const header: unknown = response.headers['set-cookie'];
  if (!Array.isArray(header) || typeof header[0] !== 'string') {
    throw new Error('expected a set-cookie header');
  }
  return header[0];
};

const makeApp = (controller: Controller, middleware?: Middleware): express.Express => {
  const app = express();
  app.use(express.json());
  if (middleware !== undefined) {
    app.post('/probe', adaptMiddleware(middleware), adaptRoute(controller));
  } else {
    app.post('/probe', adaptRoute(controller));
  }
  return app;
};

const echoController: Controller = {
  handle(httpRequest: unknown): Promise<HttpResponse> {
    return Promise.resolve({statusCode: 200, body: httpRequest});
  },
};

describe('adaptRoute', () => {
  it('sends an explicit html response without JSON quoting it', async () => {
    const controller: Controller = {
      handle(): Promise<HttpResponse> {
        return Promise.resolve({statusCode: 200, body: '<h1>Confirmed</h1>', bodyType: 'html'});
      },
    };
    const app = express();
    app.get('/probe', adaptRoute(controller));

    const response = await request(app).get('/probe');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toBe('<h1>Confirmed</h1>');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('applies the security attributes the adapter owns, not the controller', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    const controller: Controller = {
      handle(): Promise<HttpResponse> {
        return Promise.resolve({
          statusCode: 201,
          body: {ok: true},
          cookies: [{action: 'set', name: 'sid', value: 'deadbeef', expiresAt}],
        });
      },
    };

    const response = await request(makeApp(controller)).post('/probe').send({});
    const cookie = firstSetCookie(response);

    expect(response.status).toBe(201);
    expect(cookie).toContain('sid=deadbeef');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain');
  });

  it('clears a cookie', async () => {
    const controller: Controller = {
      handle(): Promise<HttpResponse> {
        return Promise.resolve({statusCode: 204, body: null, cookies: [{action: 'clear', name: 'sid'}]});
      },
    };

    const cookie = firstSetCookie(await request(makeApp(controller)).post('/probe').send({}));

    expect(cookie).toContain('sid=;');
  });

  it('hands the controller the parsed cookies, so logout needs no middleware', async () => {
    const response = await request(makeApp(echoController)).post('/probe').set('Cookie', 'sid=abc123').send({});

    expect(response.body.cookies).toEqual({sid: 'abc123'});
  });

  it('overrides a cookies field supplied in the body', async () => {
    const response = await request(makeApp(echoController))
      .post('/probe')
      .set('Cookie', 'sid=real')
      .send({cookies: {sid: 'forged'}});

    expect(response.body.cookies).toEqual({sid: 'real'});
  });

  it('lets res.locals outrank a client trying to spoof userId in the body', async () => {
    const middleware: Middleware = {
      handle(): Promise<HttpResponse> {
        return Promise.resolve({statusCode: 200, body: {userId: 'from-session'}});
      },
    };

    const response = await request(makeApp(echoController, middleware))
      .post('/probe')
      .send({userId: 'spoofed-by-client', other: 'kept'});

    expect(response.body.userId).toBe('from-session');
    expect(response.body.other).toBe('kept');
  });

  it('lets a path parameter outrank a query string of the same name', async () => {
    const app = express();
    app.use(express.json());
    app.get('/probe/:id', adaptRoute(echoController));

    const response = await request(app).get('/probe/from-path?id=from-query');

    expect(response.body.id).toBe('from-path');
  });
});

describe('adaptMiddleware', () => {
  it('stops the request when the middleware rejects it', async () => {
    const middleware: Middleware = {
      handle(): Promise<HttpResponse> {
        return Promise.resolve({statusCode: 401, body: {error: 'Unauthorized'}});
      },
    };

    const response = await request(makeApp(echoController, middleware)).post('/probe').send({});

    expect(response.status).toBe(401);
    expect(response.body).toEqual({error: 'Unauthorized'});
  });

  it('hands the middleware the parsed cookies', async () => {
    let seen: Record<string, string> | null = null;
    const middleware: Middleware = {
      handle(middlewareRequest): Promise<HttpResponse> {
        seen = middlewareRequest.cookies;
        return Promise.resolve({statusCode: 200, body: {}});
      },
    };

    await request(makeApp(echoController, middleware)).post('/probe').set('Cookie', 'sid=abc123; junk=x').send({});

    expect(seen).toEqual({sid: 'abc123', junk: 'x'});
  });

  it('applies headers a controller asked for, overriding a middleware default', async () => {
    const controller: Controller = {
      handle(): Promise<HttpResponse> {
        return Promise.resolve({
          statusCode: 200,
          body: {ok: true},
          headers: {'cache-control': 'public, max-age=3600'},
        });
      },
    };
    const app = express();
    app.use((_req, res, next) => {
      res.set('cache-control', 'no-store');
      next();
    });
    app.post('/probe', adaptRoute(controller));

    const response = await request(app).post('/probe').send({});

    expect(response.headers['cache-control']).toBe('public, max-age=3600');
  });

  it('refuses header names a controller has no business setting', async () => {
    const controller: Controller = {
      handle(): Promise<HttpResponse> {
        return Promise.resolve({
          statusCode: 200,
          body: {},
          headers: {
            'set-cookie': 'sid=stolen',
            'access-control-allow-origin': '*',
            'cache-control': 'public, max-age=60',
          },
        });
      },
    };
    const app = express();
    app.use((_req, res, next) => {
      res.set('access-control-allow-origin', 'https://app.example.com');
      next();
    });
    app.post('/probe', adaptRoute(controller));

    const response = await request(app).post('/probe').send({});

    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).toBe('https://app.example.com');
    expect(response.headers['cache-control']).toBe('public, max-age=60');
  });

  it('adds to Vary rather than replacing what the middleware stack declared', async () => {
    const controller: Controller = {
      handle(): Promise<HttpResponse> {
        return Promise.resolve({statusCode: 200, body: {}, headers: {vary: 'Cookie'}});
      },
    };
    const app = express();
    app.use((_req, res, next) => {
      res.append('vary', 'origin');
      next();
    });
    app.post('/probe', adaptRoute(controller));

    const response = await request(app).post('/probe').send({});

    const vary = response.headers.vary ?? '';
    expect(vary).toContain('origin');
    expect(vary).toContain('Cookie');
  });

  it('still lets a controller replace cache-control outright', async () => {
    const controller: Controller = {
      handle(): Promise<HttpResponse> {
        return Promise.resolve({
          statusCode: 200,
          body: {},
          headers: {'cache-control': 'private, max-age=60'},
        });
      },
    };
    const app = express();
    app.use((_req, res, next) => {
      res.set('cache-control', 'no-store');
      next();
    });
    app.post('/probe', adaptRoute(controller));

    expect((await request(app).post('/probe').send({})).headers['cache-control']).toBe('private, max-age=60');
  });

  it('leaves the default alone when a controller asks for nothing', async () => {
    const app = express();
    app.use((_req, res, next) => {
      res.set('cache-control', 'no-store');
      next();
    });
    app.post('/probe', adaptRoute(echoController));

    expect((await request(app).post('/probe').send({})).headers['cache-control']).toBe('no-store');
  });
});
