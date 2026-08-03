import { screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse } from './test/http'
import { renderAt } from './test/render'

const signedIn = { id: '1', email: 'a@b.co', alertThreshold: 5 }

describe('the route table', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse(401, { error: 'Unauthorized' }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => { vi.unstubAllGlobals() })

  const withSession = (): void => {
    fetchMock.mockImplementation(async () => jsonResponse(200, signedIn))
  }

  it('resolves / to the home screen', async () => {
    renderAt('/')

    expect(await screen.findByRole('heading', { level: 1 }))
      .toHaveTextContent('Paste a URL')
  })

  it('resolves /dashboard for a signed-in visitor', async () => {
    withSession()

    renderAt('/dashboard')

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  })

  it('resolves /pages/:id for a signed-in visitor, and passes the id through', async () => {
    withSession()

    renderAt('/pages/42')

    expect(await screen.findByRole('heading', { level: 1, name: 'Page 42' })).toBeVisible()
  })

  it('resolves /r/:uuid without a session, because the uuid is the credential', async () => {
    // The assertion that matters is the second one. Rendering the screen while
    // signed out is only half of it: gating this route would defeat the point
    // of a link you can send to a colleague, and asking the server who you are
    // in order to show it would be the first step toward gating it.
    renderAt('/r/abc-123')

    expect(await screen.findByRole('heading', { level: 1, name: 'Audit result' })).toBeVisible()
    expect(screen.getByText(/abc-123/)).toBeVisible()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends a signed-out visitor away from a guarded route', async () => {
    renderAt('/dashboard')

    // Landed on home, not on the dashboard behind a spinner.
    expect(await screen.findByRole('heading', { level: 1 }))
      .toHaveTextContent('Paste a URL')
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('does not treat a broken /me as being signed out', async () => {
    // The failure mode this exists to prevent: a 500 from the session endpoint
    // silently reading as "logged out" and bouncing every signed-in user to a
    // home page, on a backend that could not have logged them in either.
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Internal server error' }))

    renderAt('/dashboard')

    expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }))
      .toBeVisible()
  })

  it('renders 404 for an unknown path, inside the shell', async () => {
    renderAt('/nope')

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    // Inside the shell, so there is still a header and a way out.
    expect(screen.getByRole('link', { name: 'tabstop' })).toBeVisible()
  })

  it('keeps the shell when a screen fails', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: 'Internal server error' }))

    renderAt('/dashboard')

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    })
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument()
  })
})
