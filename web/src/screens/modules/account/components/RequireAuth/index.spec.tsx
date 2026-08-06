import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RETURN_TO_KEY, RequireAuth, SIGNED_OUT_REDIRECT } from './index'
import { jsonResponse } from '@/test/http'

const account = { id: '1', email: 'a@b.co', alertThreshold: 5 }

/**
 * A two-route memory router, because everything this component does is about
 * navigation: it either renders its children in place or replaces them with a
 * redirect, and a spec that cannot see where the redirect went can only assert
 * that the children are absent - which a crash would also satisfy.
 *
 * The landing route reports the location back into the DOM so the spec can read
 * the state `Navigate` carried without reaching into router internals.
 */
const Landing = (): React.JSX.Element => {
  const location = useLocation()
  const state = location.state as Record<string, unknown> | null

  return (
    <div>
      <h1>Signed out landing</h1>
      <p data-returnto={String(state?.[RETURN_TO_KEY] ?? '')}>landed</p>
    </div>
  )
}

/**
 * Two entries deep on purpose, sitting on the second. `/start` is what a
 * correctly REPLACED redirect leaves behind Back; the gate itself is what a
 * pushed one would.
 */
const renderGate = (): ReturnType<typeof createMemoryRouter> => {
  const router = createMemoryRouter([
    { path: '/start', element: <h1>Where they came from</h1> },
    { path: '/dashboard', element: <RequireAuth><h1>Protected</h1></RequireAuth> },
    { path: SIGNED_OUT_REDIRECT, element: <Landing /> }
  ], { initialEntries: ['/start', '/dashboard'], initialIndex: 1 })

  render(
    <QueryClientProvider client={new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  return router
}

describe('RequireAuth', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse(401, { error: 'Unauthorized' }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('renders its children once there is a session', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, account))

    renderGate()

    expect(await screen.findByRole('heading', { name: 'Protected' })).toBeVisible()
  })

  it('asks the server, because the session cookie is httpOnly and unreadable here', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, account))

    renderGate()
    await screen.findByRole('heading', { name: 'Protected' })

    // There is no local check this could have used instead. If this ever stops
    // being a round trip, something is reading auth state it cannot see.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toContain('/api/me')
  })

  it('shows nothing at all while the answer is in flight', async () => {
    // Not a spinner. This resolves in one round trip the browser has probably
    // already started, and a spinner that appears for 80ms and vanishes is
    // worse than a beat of nothing - to a screen reader it is an announcement
    // about a state that no longer holds.
    let release = (): void => {}
    fetchMock.mockImplementation(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return jsonResponse(200, account)
    })

    renderGate()

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(document.body).toHaveTextContent('')
    release()
    expect(await screen.findByRole('heading', { name: 'Protected' })).toBeVisible()
  })

  it('sends a signed-out visitor to the landing route', async () => {
    renderGate()

    expect(await screen.findByRole('heading', { name: 'Signed out landing' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Protected' })).not.toBeInTheDocument()
  })

  it('carries where they were going, so a login can send them back', async () => {
    renderGate()

    await screen.findByRole('heading', { name: 'Signed out landing' })

    expect(screen.getByText('landed')).toHaveAttribute('data-returnto', '/dashboard')
  })

  it('replaces the gated entry rather than pushing over it', async () => {
    // Without `replace`, Back from the landing page returns to the gate, which
    // redirects straight to the landing page again: the visitor is trapped and
    // the browser's Back button looks broken.
    //
    // Driven through the router rather than `window.history`, which a memory
    // router does not listen to - going through the window made this assertion
    // pass with `replace` removed, which is how the vacuous version was caught.
    const router = renderGate()
    await screen.findByRole('heading', { name: 'Signed out landing' })

    await act(async () => { await router.navigate(-1) })

    expect(await screen.findByRole('heading', { name: 'Where they came from' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/start')
  })

  it('rethrows a real failure instead of calling it signed out', async () => {
    // The failure mode this exists to prevent. A 500 read as "logged out"
    // bounces every signed-in user to a login page that could not work either,
    // and turns a backend outage into a support ticket about lost accounts.
    fetchMock.mockImplementation(async () =>
      jsonResponse(500, { error: 'Internal server error' }))

    const router = createMemoryRouter([{
      path: '/dashboard',
      element: <RequireAuth><h1>Protected</h1></RequireAuth>,
      errorElement: <h1>Boundary caught it</h1>
    }], { initialEntries: ['/dashboard'] })

    render(
      <QueryClientProvider client={new QueryClient({
        defaultOptions: { queries: { retry: false } }
      })}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    expect(await screen.findByRole('heading', { name: 'Boundary caught it' })).toBeVisible()
  })
})
