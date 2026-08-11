import {render, screen} from '@testing-library/react';
import {StrictMode} from 'react';
import {createBrowserRouter, createMemoryRouter} from 'react-router';
import type * as reactRouter from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {App} from './app';
import {makeQueryClient} from './api/query-client';
import {makeRoutes} from './routes';

/**
 * The module is spied on rather than replaced: `RouterProvider` and everything
 * the screens import must stay real, or this stops being a test of the app.
 */
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof reactRouter>();
  return {...actual, createBrowserRouter: vi.fn(actual.createBrowserRouter)};
});

const createBrowserRouterSpy = vi.mocked(createBrowserRouter);

/**
 * The composition root, tested through what it composes.
 *
 * There is nothing here to unit test - it is a router inside a query provider -
 * but the wiring is exactly the kind of thing that breaks silently: a missing
 * `QueryClientProvider` throws only once some descendant calls `useQuery`, and
 * no other spec can catch that, because every other spec brings its own.
 */
describe('App', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({error: 'Unauthorized'}), {
          status: 401,
          headers: {'content-type': 'application/json'},
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // `createBrowserRouter` reads the real location, so a test that changed it
    // would otherwise decide where the next one starts.
    window.history.pushState({}, '', '/');
  });

  const renderApp = (): void => {
    const queryClient = makeQueryClient();
    render(<App queryClient={queryClient} router={createBrowserRouter(makeRoutes(queryClient))} />);
  };

  it("renders the app at the browser's current location", async () => {
    // Through the real `createBrowserRouter`, not the memory router every other
    // spec uses - so this is the one place the production router is exercised.
    renderApp();

    expect(await screen.findByRole('heading', {level: 1})).toHaveTextContent('Accessibility monitoring');
  });

  it('provides a query client its descendants can actually use', async () => {
    // Mounted at a GUARDED route on purpose. Nothing on the home screen calls
    // `useQuery`, so rendering there passes with the provider deleted - which
    // is exactly what the first version of this test did. `/dashboard` renders
    // the header's `useSession`, where a missing provider throws.
    window.history.pushState({}, '', '/dashboard');

    renderApp();

    // The 401 sends the gate to the real login route, which is reachable only
    // by having asked through the query provider.
    expect(await screen.findByRole('heading', {level: 1, name: 'Log in'})).toBeVisible();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('builds no router of its own, so StrictMode cannot orphan one', async () => {
    // The bug this shape exists to prevent, asserted on the construction itself.
    //
    // StrictMode double-invokes component bodies AND `useState` initialisers -
    // measured, not assumed - and `createBrowserRouter` calls `initialize()`,
    // which subscribes to browser history. Constructing one anywhere inside this
    // subtree therefore leaves a second router listening to `popstate` with no
    // owner and no way to dispose it. A lazy initialiser does not save you.
    const router = createMemoryRouter(makeRoutes(makeQueryClient()), {initialEntries: ['/']});
    createBrowserRouterSpy.mockClear();

    render(
      <StrictMode>
        <App queryClient={makeQueryClient()} router={router} />
      </StrictMode>,
    );

    await screen.findByRole('heading', {level: 1});
    expect(createBrowserRouterSpy).not.toHaveBeenCalled();
  });
});
