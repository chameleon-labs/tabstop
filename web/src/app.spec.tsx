import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './app'
import { makeQueryClient } from './api/query-client'

/**
 * The composition root, tested through what it composes.
 *
 * There is nothing here to unit test - it is a router inside a query provider -
 * but the wiring is exactly the kind of thing that breaks silently: a missing
 * `QueryClientProvider` throws only once some descendant calls `useQuery`, and
 * no other spec can catch that, because every other spec brings its own.
 */
describe('App', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'content-type': 'application/json' }
      }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // `createBrowserRouter` reads the real location, so a test that changed it
    // would otherwise decide where the next one starts.
    window.history.pushState({}, '', '/')
  })

  it('renders the app at the browser\'s current location', async () => {
    // Through the real `createBrowserRouter`, not the memory router every other
    // spec uses - so this is the one place the production router is exercised.
    render(<App queryClient={makeQueryClient()} />)

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Paste a URL')
  })

  it('provides a query client its descendants can actually use', async () => {
    // Mounted at a GUARDED route on purpose. Nothing on the home screen calls
    // `useQuery`, so rendering there passes with the provider deleted - which
    // is exactly what the first version of this test did. `/dashboard` goes
    // through `RequireAuth` into `useSession`, where a missing provider throws.
    window.history.pushState({}, '', '/dashboard')

    render(<App queryClient={makeQueryClient()} />)

    // The 401 sends the gate home, which is reachable only by having asked.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Paste a URL')
    expect(fetchMock).toHaveBeenCalled()
  })
})
