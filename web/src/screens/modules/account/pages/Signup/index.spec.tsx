import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {routes} from '@/routes';
import {jsonResponse} from '@/test/http';
import {Signup} from './index';

const account = {id: '1', email: 'person@example.com', alertThreshold: 5};
const credentials = {email: 'person@example.com', password: 'a-secure-password'};

describe('Signup', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'})));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const openSignup = async (state?: unknown) => {
    const router = createMemoryRouter(routes, {initialEntries: [{pathname: '/signup', state}]});
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {retry: false, staleTime: 30_000},
        mutations: {retry: false},
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await screen.findByRole('heading', {level: 1, name: 'Create an account'});
    return {router};
  };

  const enterCredentials = async (user: ReturnType<typeof userEvent.setup>): Promise<void> => {
    await user.type(screen.getByLabelText('Email address'), credentials.email);
    await user.type(screen.getByLabelText('Password'), credentials.password);
  };

  const succeedSignup = (): void => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}))
      .mockResolvedValueOnce(jsonResponse(201, account))
      .mockResolvedValueOnce(jsonResponse(200, account));
  };

  it('presents account creation with browser password-manager hints and the page title', async () => {
    await openSignup();

    await waitFor(() => {
      expect(document.title).toBe('Create an account · tabstop');
    });
    expect(screen.getByRole('heading', {level: 1, name: 'Create an account'})).toBeVisible();
    expect(screen.getByLabelText('Email address')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByText('12–200 characters')).toBeVisible();
    expect(within(screen.getByRole('main')).getByRole('link', {name: 'Log in'})).toHaveAttribute('href', '/login');
  });

  it('defers validation until submit, then focuses the first invalid field', async () => {
    const user = userEvent.setup();
    await openSignup();

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');

    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument();
    expect(screen.queryByText('Use at least 12 characters')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {name: 'Create account'}));

    expect(screen.getByText('Enter a valid email address')).toBeVisible();
    expect(screen.getByText('Use at least 12 characters')).toBeVisible();
    expect(screen.getByLabelText('Email address')).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('focuses password when it is the first invalid field', async () => {
    const user = userEvent.setup();
    await openSignup();

    await user.type(screen.getByLabelText('Email address'), credentials.email);
    await user.click(screen.getByRole('button', {name: 'Create account'}));

    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByText('Use at least 12 characters')).toBeVisible();
  });

  it('updates field errors live after the first submit', async () => {
    const user = userEvent.setup();
    await openSignup();

    await user.click(screen.getByRole('button', {name: 'Create account'}));
    const email = screen.getByLabelText('Email address');
    const password = screen.getByLabelText('Password');

    await user.type(email, credentials.email);
    await user.type(password, 'x'.repeat(12));

    expect(screen.queryByText('Enter your email address')).not.toBeInTheDocument();
    expect(screen.queryByText('Use at least 12 characters')).not.toBeInTheDocument();
  });

  it.each([
    {length: 11, message: 'Use at least 12 characters'},
    {length: 201, message: 'Use no more than 200 characters'},
  ])('rejects a $length-character password', async ({length, message}) => {
    const user = userEvent.setup();
    await openSignup();

    await user.type(screen.getByLabelText('Email address'), credentials.email);
    await user.type(screen.getByLabelText('Password'), 'x'.repeat(length));
    await user.click(screen.getByRole('button', {name: 'Create account'}));

    expect(screen.getByText(message)).toBeVisible();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([12, 200])('accepts a %s-character password', async (length) => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}))
      .mockResolvedValueOnce(jsonResponse(409, {error: 'This email is already registered'}));
    await openSignup();

    await user.type(screen.getByLabelText('Email address'), credentials.email);
    await user.type(screen.getByLabelText('Password'), 'x'.repeat(length));
    await user.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('This email is already registered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows the exact duplicate-email error, focuses its alert, and preserves the entered values', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}))
      .mockResolvedValueOnce(jsonResponse(409, {error: 'This email is already registered'}));
    await openSignup();
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Create account'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This email is already registered');
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Email address')).toHaveValue(credentials.email);
    expect(screen.getByLabelText('Password')).toHaveValue(credentials.password);
  });

  it('keeps the form when session confirmation cannot be reached after signup', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'}))
      .mockResolvedValueOnce(jsonResponse(201, account))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await openSignup();
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Create account'}));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach tabstop. Check your connection and try again');
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Email address')).toHaveValue(credentials.email);
    expect(screen.getByLabelText('Password')).toHaveValue(credentials.password);
    expect(screen.getByRole('button', {name: 'Create account'})).toBeEnabled();
  });

  it('locks every form control while the signup request is pending', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {error: 'Unauthorized'})).mockImplementationOnce(
      () =>
        new Promise<Response>(() => {
          // Keep the mutation pending so every form control can be inspected in that state.
        }),
    );
    await openSignup();
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Create account'}));

    await waitFor(() => {
      expect(screen.getByLabelText('Email address')).toBeDisabled();
    });
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Show password'})).toBeDisabled();
    expect(screen.getByRole('button', {name: 'Creating account…'})).toBeDisabled();
    expect(screen.queryByRole('button', {name: 'Create account'})).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('submits with Enter, confirms the session, and replaces with the default destination', async () => {
    const user = userEvent.setup();
    succeedSignup();
    const {router} = await openSignup();
    await enterCredentials(user);

    await user.type(screen.getByLabelText('Password'), '{Enter}');

    expect(await screen.findByRole('heading', {level: 1, name: 'Dashboard'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/dashboard');
    expect(router.state.location.search).toBe('');
    expect(router.state.location.hash).toBe('');
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/me', expect.objectContaining({credentials: 'include'}));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/signup',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify(credentials),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/me', expect.objectContaining({credentials: 'include'}));
  });

  it('returns to the full recorded destination after confirming the session', async () => {
    const user = userEvent.setup();
    succeedSignup();
    const {router} = await openSignup({from: '/pages/42?days=30#history'});
    await enterCredentials(user);

    await user.click(screen.getByRole('button', {name: 'Create account'}));

    expect(await screen.findByRole('heading', {level: 1, name: 'Page 42'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/pages/42');
    expect(router.state.location.search).toBe('?days=30');
    expect(router.state.location.hash).toBe('#history');
  });

  it('carries the recorded destination back to login', async () => {
    const user = userEvent.setup();
    const state = {from: '/pages/42?days=30#history'};
    const {router} = await openSignup(state);

    await user.click(within(screen.getByRole('main')).getByRole('link', {name: 'Log in'}));

    expect(await screen.findByRole('heading', {level: 1, name: 'Log in'})).toBeVisible();
    expect(router.state.location.state).toEqual(state);
  });

  it('replaces the signup history entry after a successful standalone signup', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(201, account)).mockResolvedValueOnce(jsonResponse(200, account));
    const router = createMemoryRouter(
      [
        {path: '/before-signup', element: <h1>Before signup</h1>},
        {path: '/signup', element: <Signup />},
        {path: '/dashboard', element: <h1>Dashboard</h1>},
      ],
      {initialEntries: ['/before-signup', '/signup'], initialIndex: 1},
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

    await user.click(screen.getByRole('button', {name: 'Create account'}));
    expect(await screen.findByRole('heading', {name: 'Dashboard'})).toBeVisible();

    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByRole('heading', {name: 'Before signup'})).toBeVisible();
    expect(router.state.location.pathname).toBe('/before-signup');
  });
});
