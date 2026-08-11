import {QueryClient} from '@tanstack/react-query';
import {RouterContextProvider} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ApiError} from '@/api/client';
import {jsonResponse} from '@/test/http';
import {requireAnonymous, requireSession} from './guards';
import {sessionKeys} from './session';

const account = {id: '7', email: 'george@example.test', alertThreshold: 5};

const ORIGIN = 'https://tabstop.test';

/**
 * The loaders are exercised directly rather than through a router.
 *
 * A route loader's whole contract is the Response it throws, and a mounted
 * router consumes that Response and shows a screen - so a spec that goes
 * through one can see WHERE the visitor ended up, but not whether the redirect
 * asked to replace the entry, and not which failures the guard declined to turn
 * into a redirect at all. `routes.spec.tsx` covers the reachable half; this
 * covers what the router swallows.
 *
 * `url` carries the fragment and the Request does not - the router strips it on
 * the way in and restores it here - so both are built, from one path, rather
 * than letting the spec hand itself a pair that could never occur together.
 */
const run = async (loader: ReturnType<typeof requireSession>, path: string): Promise<unknown> => {
  const url = new URL(path, ORIGIN);
  const request = new Request(`${ORIGIN}${url.pathname}${url.search}`);

  return await loader({request, url, params: {}, pattern: '/', context: new RouterContextProvider()});
};

/**
 * The thrown Response, or a failure naming what came instead - so a guard that
 * throws an Error where a redirect belongs reports that, rather than
 * `undefined` on a property access.
 */
const redirectFrom = async (loader: ReturnType<typeof requireSession>, path: string): Promise<Response> => {
  // Settled into a value rather than caught, so this helper's own failure
  // messages cannot be swallowed by its own `catch` and reported as the
  // loader's.
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
    // No retries: a spec asserting a failure path should not wait out a backoff
    // schedule to see it. `staleTime` is not set here - it belongs to
    // `sessionQueryOptions`, and overriding it would hide it going missing.
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

      // There is no local check this could have used instead. If this ever
      // stops being a round trip, something is reading auth state it cannot see.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toContain('/api/me');
    });

    it('leaves the answer in the cache the header reads', async () => {
      // The loader and `AccountNavigation` ask the same question milliseconds
      // apart. A loader holding its own copy makes that two round trips on
      // every guarded navigation, and nothing on screen would look wrong.
      withSession();

      await run(requireSession(queryClient), '/dashboard');

      expect(queryClient.getQueryData(sessionKeys.me)).toEqual(account);
    });

    it('sends a signed-out visitor to the login screen', async () => {
      // The literal, not `SIGNED_OUT_REDIRECT`. Asserting against the constant
      // the guard reads moves both sides together, so it passes whatever the
      // constant is changed to - which is how the first version of this passed
      // with the destination set to `/`.
      const response = await redirectFrom(requireSession(queryClient), '/dashboard');

      expect(new URL(response.headers.get('location') ?? '', ORIGIN).pathname).toBe('/login');
    });

    it('records the complete destination, so login can send them back', async () => {
      // All three parts. The query is what made the link worth sending, and the
      // fragment is where on the page they were - and the fragment is the one
      // that goes missing, because `request.url` does not carry it.
      const response = await redirectFrom(requireSession(queryClient), '/pages/42?days=30#history');

      expect(response.headers.get('location')).toBe('/login?from=%2Fpages%2F42%3Fdays%3D30%23history');
    });

    it('replaces the guarded entry rather than pushing over it', async () => {
      // Without this, Back from login returns to the guarded route, which
      // redirects to login again: the visitor is trapped and Back looks broken.
      const response = await redirectFrom(requireSession(queryClient), '/dashboard');

      expect(response.headers.get('X-Remix-Replace')).toBe('true');
    });

    it('rethrows a real failure instead of calling it signed out', async () => {
      // The failure mode this exists to prevent. A 500 read as "logged out"
      // bounces every signed-in user to a login page that could not work
      // either, and turns a backend outage into support tickets about lost
      // accounts. It has to reach the error boundary as an error, which means
      // NOT arriving as a redirect.
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
      // `from` is in the address bar, so anyone can write it. A login page that
      // forwards wherever it is told is a phishing primitive: the link carries
      // a real tabstop origin, and the visitor lands somewhere else already
      // trusting it. `destinationFrom` owns the rule; this asserts the guard
      // actually applies it rather than reading the parameter itself.
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
      // The mirror of the `requireSession` case, and the less obvious half: a
      // 500 read as "signed out" here renders the login form, the visitor
      // types their password into a backend that cannot check it, and the
      // failure looks like rejected credentials.
      withBrokenBackend();

      await expect(run(requireAnonymous(queryClient), '/login')).rejects.toBeInstanceOf(ApiError);
    });
  });
});
