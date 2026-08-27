import {render, screen} from '@testing-library/react';
import {StrictMode} from 'react';
import {createBrowserRouter, createMemoryRouter} from 'react-router';
import type * as reactRouter from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {App} from './app';
import {makeQueryClient} from './api/query-client';
import {makeRoutes} from './routes';

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof reactRouter>();
  return {...actual, createBrowserRouter: vi.fn(actual.createBrowserRouter)};
});

const createBrowserRouterSpy = vi.mocked(createBrowserRouter);

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
    window.history.pushState({}, '', '/');
  });

  const renderApp = (): void => {
    const queryClient = makeQueryClient();
    render(<App queryClient={queryClient} router={createBrowserRouter(makeRoutes(queryClient))} />);
  };

  it("renders the app at the browser's current location", async () => {
    renderApp();

    expect(await screen.findByRole('heading', {level: 1})).toHaveTextContent('Accessibility monitoring');
  });

  it('provides a query client its descendants can actually use', async () => {
    window.history.pushState({}, '', '/dashboard');

    renderApp();

    expect(await screen.findByRole('heading', {level: 1, name: 'Log in'})).toBeVisible();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('builds no router of its own, so StrictMode cannot orphan one', async () => {
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
