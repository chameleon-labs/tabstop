import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useEffect} from 'react';
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

const renderSignOut = (): Harness => {
  const latest: {current: (() => Promise<void>) | null} = {current: null};

  const Probe = (): React.JSX.Element => {
    const signOut = useSignOut(useLogout());

    useEffect(() => {
      latest.current = signOut;
    });

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
      const call = latest.current;
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

  const withRevoke = (): void => {
    fetchMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/api/logout' ? new Response(null, {status: 204}) : jsonResponse(401, {error: 'Unauthorized'}),
      ),
    );
  };

  const withBrokenBackend = (): void => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Could not revoke this session'})));
  };

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
    withSurvivingSession();
    const {signOut, router} = renderSignOut();

    await signOut();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/logout', '/api/me']);
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('settles rather than rejecting, so a caller can fire it and forget it', async () => {
    withBrokenBackend();
    const {signOut} = renderSignOut();

    await expect(signOut()).resolves.toBeUndefined();
  });
});
