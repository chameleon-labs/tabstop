import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {jsonResponse} from '@/test/http';
import {useLogout} from '../mutations';
import {useSignOut} from './use-sign-out';

const account = {id: '7', email: 'ada.lovelace@example.test', alertThreshold: 5};

type Harness = {
  router: ReturnType<typeof createMemoryRouter>;
  signOut: () => Promise<void>;
};

/**
 * Two entries deep, because one cannot tell a replace from a push: both leave
 * the visitor at `/`, and only the back button disagrees.
 *
 * The real `useLogout` rather than a stand-in - the hook branches on whether
 * `mutateAsync` settled, which is the one thing a hand-built mutation would
 * have to assert about itself.
 */
const renderSignOut = (): Harness => {
  let latest: (() => Promise<void>) | null = null;

  const Probe = (): React.JSX.Element => {
    latest = useSignOut(useLogout());

    return <p>settings</p>;
  };

  const router = createMemoryRouter(
    [
      {path: '/', element: <p>home</p>},
      {path: '/dashboard', element: <p>dashboard</p>},
      {path: '/settings', element: <Probe />},
    ],
    {initialEntries: ['/dashboard', '/settings'], initialIndex: 1},
  );

  render(
    <QueryClientProvider
      client={new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}})}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {
    router,
    signOut: async (): Promise<void> => {
      const call = latest;
      if (call === null) {
        throw new Error('the probe never rendered, so there is no sign-out to call');
      }

      await act(async () => {
        await call();
      });
    },
  };
};

describe('useSignOut', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Revoked, and the session gone with it. */
  const withRevoke = (): void => {
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/api/logout' ? new Response(null, {status: 204}) : jsonResponse(401, {error: 'Unauthorized'}),
      ),
    );
  };

  /** The revoke never lands. */
  const withBrokenBackend = (): void => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Could not revoke this session'})));
  };

  /** The revoke reports success, and the session outlives it anyway. */
  const withSurvivingSession = (): void => {
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(path === '/api/logout' ? new Response(null, {status: 204}) : jsonResponse(200, account)),
    );
  };

  it('revokes the session before going anywhere', async () => {
    withRevoke();
    const {signOut, router} = renderSignOut();

    await signOut();

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/logout');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({method: 'POST'});
    expect(router.state.location.pathname).toBe('/');
  });

  it('replaces the signed-in page, so back does not return to it', async () => {
    // Push would leave `/settings` one step behind `/`, and it renders for
    // nobody now.
    withRevoke();
    const {signOut, router} = renderSignOut();

    await signOut();
    await act(async () => {
      await router.navigate(-1);
    });

    expect(router.state.location.pathname).toBe('/dashboard');
  });

  it('stays put when the revoke fails', async () => {
    withBrokenBackend();
    const {signOut, router} = renderSignOut();

    await signOut();

    expect(router.state.location.pathname).toBe('/settings');
  });

  it('stays put when the revoke reports success but the session survives it', async () => {
    // The dangerous one: the POST looked fine, and only the re-read disagrees.
    // Leaving here puts a live session behind a page saying it ended.
    withSurvivingSession();
    const {signOut, router} = renderSignOut();

    await signOut();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout', '/api/me']);
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('settles rather than rejecting, so a caller can fire it and forget it', async () => {
    // `void signOut()` on a rejecting promise is an unhandled rejection.
    withBrokenBackend();
    const {signOut} = renderSignOut();

    await expect(signOut()).resolves.toBeUndefined();
  });
});
