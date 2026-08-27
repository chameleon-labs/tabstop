import {QueryClient} from '@tanstack/react-query';
import {RouterContextProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError} from '@/api/client';
import {jsonResponse} from '@/test/http';
import {requireAnonymous, requireSession} from './guards';
import {sessionKeys} from './session';

const account = {id: '7', email: 'george@example.test', alertThreshold: 5};

const ORIGIN = 'https://tabstop.test';

const run = async (loader: ReturnType<typeof requireSession>, path: string): Promise<unknown> => {
  const url = new URL(path, ORIGIN);
  const request = new Request(`${ORIGIN}${url.pathname}${url.search}`);

  return await loader({request, url, params: {}, pattern: '/', context: new RouterContextProvider()});
};

const redirectFrom = async (loader: ReturnType<typeof requireSession>, path: string): Promise<Response> => {
  const outcome = await run(loader, path).then(
    (returned) => ({threw: false, value: returned}) as const,
    (error: unknown) => ({threw: true, value: error}) as const,
  );

  if (!outcome.threw) {
    throw new Error(`expected a redirect, but the loader returned ${JSON.stringify(outcome.value)}`);
  }
  if (!(outcome.value instanceof Response)) {
    throw new Error(`expected a redirect Response, but the loader threw ${String(outcome.value)}`, {
      cause: outcome.value,
    });
  }

  return outcome.value;
};

describe('the route guards', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'})));
    vi.stubGlobal('fetch', fetchMock);
    queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const withSession = (): void => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, account)));
  };

  const withBrokenBackend = (): void => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Internal server error'})));
  };

  describe('requireSession', () => {
    it('hands the account to the screen rather than making it ask again', async () => {
      withSession();

      await expect(run(requireSession(queryClient), '/dashboard')).resolves.toEqual(account);
    });

    it('asks the server, because the session cookie is httpOnly and unreadable here', async () => {
      withSession();

      await run(requireSession(queryClient), '/dashboard');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toContain('/api/me');
    });

    it('leaves the answer in the cache the header reads', async () => {
      withSession();

      await run(requireSession(queryClient), '/dashboard');

      expect(queryClient.getQueryData(sessionKeys.me)).toEqual(account);
    });

    it('sends a signed-out visitor to the login screen', async () => {
      const response = await redirectFrom(requireSession(queryClient), '/dashboard');

      expect(new URL(response.headers.get('location') ?? '', ORIGIN).pathname).toBe('/login');
    });

    it('records the complete destination, so login can send them back', async () => {
      const response = await redirectFrom(requireSession(queryClient), '/pages/42?days=30#history');

      expect(response.headers.get('location')).toBe('/login?from=%2Fpages%2F42%3Fdays%3D30%23history');
    });

    it('replaces the guarded entry rather than pushing over it', async () => {
      const response = await redirectFrom(requireSession(queryClient), '/dashboard');

      expect(response.headers.get('X-Remix-Replace')).toBe('true');
    });

    it('rethrows a real failure instead of calling it signed out', async () => {
      withBrokenBackend();

      await expect(run(requireSession(queryClient), '/dashboard')).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('requireAnonymous', () => {
    it('lets a signed-out visitor through to the credential screen', async () => {
      await expect(run(requireAnonymous(queryClient), '/login')).resolves.toBeNull();
    });

    it('leaves the answer in the cache the header reads', async () => {
      await run(requireAnonymous(queryClient), '/login');

      expect(queryClient.getQueryData(sessionKeys.me)).toBeNull();
    });

    it('sends a signed-in visitor to the destination they were reaching for', async () => {
      withSession();

      const response = await redirectFrom(requireAnonymous(queryClient), '/login?from=%2Fpages%2F42%3Fdays%3D30');

      expect(response.headers.get('location')).toBe('/pages/42?days=30');
    });

    it('sends a signed-in visitor to the dashboard when nothing was recorded', async () => {
      withSession();

      const response = await redirectFrom(requireAnonymous(queryClient), '/login');

      expect(response.headers.get('location')).toBe('/dashboard');
    });

    it('refuses to forward to another origin', async () => {
      withSession();

      const response = await redirectFrom(requireAnonymous(queryClient), '/login?from=https%3A%2F%2Fevil.example');

      expect(response.headers.get('location')).toBe('/dashboard');
    });

    it('replaces the credential entry rather than pushing over it', async () => {
      withSession();

      const response = await redirectFrom(requireAnonymous(queryClient), '/login');

      expect(response.headers.get('X-Remix-Replace')).toBe('true');
    });

    it('rethrows a real failure instead of letting the visitor through', async () => {
      withBrokenBackend();

      await expect(run(requireAnonymous(queryClient), '/login')).rejects.toBeInstanceOf(ApiError);
    });
  });
});
