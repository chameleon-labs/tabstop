import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {makeRoutes} from '@/routes';
import {jsonResponse} from '@/test/http';
import {returnToSearch} from '../../return-to';
import {Login} from './index';
import type {LoadPagesResponse, PageHistoryResponse, PageSummary} from '@tabstop/contract';

const monitoredPage: PageSummary = {
  id: '42',
  url: 'https://example.com/checkout',
  monitoringEnabled: true,
  createdAt: '2026-08-01T10:00:00.000Z',
  domain: 'example.com',
  latestAudit: null,
  score: null,
  previousScore: null,
  history: [],
  nextAuditAt: null,
};

const pages: LoadPagesResponse = {pages: [monitoredPage], used: 1, limit: 10};

const pageHistory: PageHistoryResponse = {pageId: '42', url: monitoredPage.url, days: 30, points: []};

const afterSignIn = (path: string): Promise<Response> =>
  Promise.resolve(path.startsWith('/api/pages/42/history') ? jsonResponse(200, pageHistory) : jsonResponse(200, pages));

const account = {id: '1', email: 'person@example.com', alertThreshold: 5};
const credentials = {email: 'person@example.com', password: 'legacy-password'};

describe('Login', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'})));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const openLogin = async (destination?: string) => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {retry: false, staleTime: 30_000},
        mutations: {retry: false},
      },
    });
    const path = destination === undefined ? '/login' : `/login${returnToSearch(destination)}`;
    const router = createMemoryRouter(makeRoutes(queryClient), {initialEntries: [path]});
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', {level: 1, name: 'Log in'});
    return {router};
  };

  const enterCredentials = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
    await user.type(screen.getByLabelText('Email address'), credentials.email);
    await user.type(screen.getByLabelText('Password'), credentials.password);
  };

  const succeedLogin = (): void => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}))
      .mockResolvedValueOnce(jsonResponse(200, account))
      .mockResolvedValueOnce(jsonResponse(200, account))
      .mockImplementation(afterSignIn);
  };

  it('presents the credential form with browser password-manager hints and the page title', async () => {
    await openLogin();

    await waitFor(() => {
      expect(document.title).toBe('Log in · tabstop');
    });
    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', {name: 'Create an account'})).toHaveAttribute('href', '/signup');
  });

  it('defers validation until submit, then focuses the first invalid field', async () => {
    const user = userEvent.setup();
    await openLogin();

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');

    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument();
    expect(screen.queryByText('Enter your password')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Log in'}));

    expect(screen.getByText('Enter a valid email address')).toBeVisible();
    expect(screen.getByText('Enter your password')).toBeVisible();
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('focuses password when it is the first invalid field', async () => {
    const user = userEvent.setup();
    await openLogin();

    await user.type(screen.getByLabelText('Email address'), credentials.email);
    await user.click(screen.getByRole('button', {name: 'Log in'}));

    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByText('Enter your password')).toBeVisible();
  });

  it('updates field errors live after the first submit', async () => {
    const user = userEvent.setup();
    await openLogin();

    await user.click(screen.getByRole('button', {name: 'Log in'}));
    const email = screen.getByLabelText('Email address');
    const password = screen.getByLabelText('Password');

    await user.type(email, credentials.email);

    expect(screen.queryByText('Enter your email address')).not.toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeVisible();

    await user.type(password, 'x');

    expect(screen.queryByText('Enter your password')).not.toBeInTheDocument();
  });

  it('shows the exact server error, focuses its alert, and preserves the entered values', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}))
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Those credentials do not match'}));
    await openLogin();
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Log in'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Those credentials do not match');
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Email address')).toHaveValue(credentials.email);
    expect(screen.getByLabelText('Password')).toHaveValue(credentials.password);
  });

  it('keeps the form when session confirmation fails after accepted credentials', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}))
      .mockResolvedValueOnce(jsonResponse(200, account))
      .mockResolvedValueOnce(jsonResponse(500, {error: 'Session confirmation failed'}));
    await openLogin();
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Log in'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Session confirmation failed');
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Email address')).toHaveValue(credentials.email);
    expect(screen.getByLabelText('Password')).toHaveValue(credentials.password);
    expect(screen.getByRole('button', {name: 'Log in'})).toBeEnabled();
  });

  it('keeps the local confirmation message when accepted credentials produce no session', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}))
      .mockResolvedValueOnce(jsonResponse(200, account))
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}));
    await openLogin();
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Log in'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm your session');
  });

  it('locks the form while the login request is pending', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}))
      .mockImplementationOnce(() => new Promise<Response>(() => {}));
    await openLogin();
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Log in'}));

    await waitFor(() => {
      expect(screen.getByLabelText('Email address')).toBeDisabled();
    });
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Show password'})).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', {name: 'Logging in…'})).toBeDisabled();
    expect(screen.queryByRole('button', {name: 'Log in'})).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('submits with Enter, confirms the session, and replaces with the default destination', async () => {
    const user = userEvent.setup();
    succeedLogin();
    const {router} = await openLogin();
    await enterCredentials(user);

    await user.type(screen.getByLabelText('Password'), '{Enter}');

    expect(await screen.findByRole('heading', {level: 1, name: 'Your pages'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/dashboard');
    expect(router.state.location.search).toBe('');
    expect(router.state.location.hash).toBe('');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/me', expect.objectContaining({credentials: 'include'}));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/login',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(credentials),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/me', expect.objectContaining({credentials: 'include'}));
    expect(fetchMock).toHaveBeenCalledWith('/api/pages', expect.objectContaining({credentials: 'include'}));
  });

  it('replaces the login history entry after a successful standalone login', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, account)).mockResolvedValueOnce(jsonResponse(200, account));
    const router = createMemoryRouter(
      [
        {path: '/before-login', element: <h1>Before login</h1>},
        {path: '/login', element: <Login />},
        {path: '/dashboard', element: <h1>Dashboard</h1>},
      ],
      {initialEntries: ['/before-login', '/login'], initialIndex: 1},
    );
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Log in'}));
    expect(await screen.findByRole('heading', {name: 'Dashboard'})).toBeVisible();

    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByRole('heading', {name: 'Before login'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/before-login');
  });

  it('returns to the full recorded destination after confirming the session', async () => {
    const user = userEvent.setup();
    succeedLogin();
    const {router} = await openLogin('/pages/42?days=30#history');
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Log in'}));

    expect(await screen.findByRole('heading', {level: 1, name: 'example.com'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/pages/42');
    expect(router.state.location.search).toBe('?days=30');
    expect(router.state.location.hash).toBe('#history');
  });

  it('carries the recorded destination to account creation', async () => {
    const user = userEvent.setup();
    const destination = '/pages/42?days=30#history';
    const {router} = await openLogin(destination);

    await user.click(screen.getByRole('link', {name: 'Create an account'}));

    expect(await screen.findByRole('heading', {level: 1, name: 'Create an account'})).toBeVisible();
    expect(router.state.location.search).toBe(returnToSearch(destination));
  });

  it('chooses the recorded destination instead of relying on the anonymous-route fallback', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, account)).mockResolvedValueOnce(jsonResponse(200, account));
    const router = createMemoryRouter(
      [
        {path: '/login', element: <Login />},
        {path: '/dashboard', element: <h1>Dashboard</h1>},
        {path: '/pages/:id', element: <h1>Recorded page</h1>},
      ],
      {initialEntries: [`/login${returnToSearch('/pages/42?days=30#history')}`]},
    );
    const queryClient = new QueryClient({
      defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Log in'}));

    expect(await screen.findByRole('heading', {name: 'Recorded page'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/pages/42');
    expect(router.state.location.search).toBe('?days=30');
    expect(router.state.location.hash).toBe('#history');
  });
});
