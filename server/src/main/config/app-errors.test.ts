import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import request from 'supertest';
import type {Express} from 'express';
import {setupApp} from './app.js';
import {connectDatabase, disconnectDatabase} from './database.js';
import {makeTestAppDependencies} from '../test/test-app-dependencies.js';

describe('framework-level failures', () => {
  let app: Express;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (url === undefined) {
      throw new Error('DATABASE_URL not set by globalSetup');
    }
    connectDatabase(url);
    const dependencies = makeTestAppDependencies();
    app = setupApp(dependencies);
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const expectsNoInternals = (text: string): void => {
    expect(text).not.toMatch(/SyntaxError|PayloadTooLargeError/);
    expect(text).not.toMatch(/node_modules|\/Users\/|\/home\/|\.pnpm/);
    expect(text).not.toMatch(/\bat [\w.]+ \(/);
  };

  it('answers malformed JSON with JSON, not an HTML stack trace', async () => {
    const response = await request(app)
      .post('/api/login')
      .set('content-type', 'application/json')
      .send('{"email": "a@b.co", "password": ');

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({error: expect.any(String)});
    expectsNoInternals(response.text);
  });

  it('answers an oversized body with JSON, not an HTML stack trace', async () => {
    const response = await request(app)
      .post('/api/login')
      .send({email: 'a@b.co', password: 'x'.repeat(200 * 1024)});

    expect(response.status).toBe(413);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({error: expect.any(String)});
    expectsNoInternals(response.text);
  });

  it('answers an unknown route with JSON', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({error: expect.any(String)});
  });

  it('answers a method no route handles with JSON', async () => {
    const response = await request(app).delete('/api/me');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({error: expect.any(String)});
  });

  it('does not advertise the framework', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('tells browsers not to sniff the content type', async () => {
    const response = await request(app).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
