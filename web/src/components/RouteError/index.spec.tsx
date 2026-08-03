import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RouteError } from '.'
import { ApiError } from '../../api/client'

/**
 * Thrown from a route ELEMENT - a query rejecting inside a screen, which is how
 * every error reaches this component today, since React Query does the fetching
 * and no route has a loader.
 *
 * Going through the router rather than rendering `RouteError` directly matters:
 * `useRouteError` is the only thing connecting the two, and a spec that
 * constructed the error itself would pass with that wiring removed.
 */
const renderThrowing = (error: unknown): void => {
  const Boom = (): React.JSX.Element => { throw error }

  const router = createMemoryRouter(
    [{ path: '/', element: <Boom />, errorElement: <RouteError /> }],
    { initialEntries: ['/'] }
  )

  render(<RouterProvider router={router} />)
}

/**
 * Thrown from a LOADER, which is the only way an `ErrorResponse` is produced.
 *
 * A `Response` thrown during render is not converted - it arrives at
 * `useRouteError` as a plain `Response` and `isRouteErrorResponse` is false. A
 * first version of these specs threw one from an element and failed, which is
 * the useful fact: the `isRouteErrorResponse` branch is unreachable from a
 * screen. It guards loaders, so it is tested through one.
 */
const renderLoaderThrowing = (response: Response): void => {
  const router = createMemoryRouter([{
    path: '/',
    loader: () => { throw response },
    element: <h1>Never rendered</h1>,
    errorElement: <RouteError />
  }], { initialEntries: ['/'] })

  render(<RouterProvider router={router} />)
}

describe('RouteError', () => {
  describe('a 404, which is not a crash', () => {
    it('renders the not-found page for an ApiError 404', async () => {
      // A share link that has expired or been mistyped. To the person holding
      // it, that is the same event as an unknown URL - not a system failure,
      // and "something went wrong" would be both wrong and alarming.
      renderThrowing(new ApiError(404, 'Audit not found', { error: 'Audit not found' }))

      expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' }))
        .toBeVisible()
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
    })

    it('renders it for a router ErrorResponse 404 as well', async () => {
      // The other way a 404 arrives: thrown by a loader, not by our fetch
      // client. No route has a loader yet, so this branch guards a shape #19
      // and #21 may introduce rather than one in use today - which is exactly
      // why it needs a test rather than a reader's confidence.
      renderLoaderThrowing(new Response(null, { status: 404, statusText: 'Not Found' }))

      expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' }))
        .toBeVisible()
    })

    it('does not treat every ApiError as a 404', async () => {
      renderThrowing(new ApiError(403, 'Forbidden', { error: 'Forbidden' }))

      expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }))
        .toBeVisible()
    })
  })

  describe('a real failure', () => {
    it('shows the sentence the server wrote', async () => {
      renderThrowing(new ApiError(500, 'The audit service is unavailable', null))

      expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }))
        .toBeVisible()
      expect(screen.getByText('The audit service is unavailable')).toBeVisible()
    })

    it('shows a router error response by its status text', async () => {
      renderLoaderThrowing(new Response(null, { status: 503, statusText: 'Service Unavailable' }))

      expect(await screen.findByText('Service Unavailable')).toBeVisible()
    })

    it('does not render an empty paragraph when there is no status text', async () => {
      // `new Response(null, { status: 503 })` has none, and HTTP/2 carries no
      // reason phrase at all - so this is the ordinary case, not a corner. An
      // empty string is not null, so it slipped past the fallback and rendered
      // a blank explanation under the heading.
      renderLoaderThrowing(new Response(null, { status: 503 }))

      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' })
      expect(screen.getByText(/do not have a useful explanation/)).toBeVisible()
    })

    it('says nothing specific about an error written for a developer', async () => {
      // A bare `Error` here is a bug in our own code, and its message is
      // written for whoever is reading a stack trace. "Cannot read properties
      // of undefined" tells a visitor nothing and reads like a leak.
      renderThrowing(new TypeError('Cannot read properties of undefined (reading foo)'))

      expect(await screen.findByRole('heading', { level: 1, name: 'Something went wrong' }))
        .toBeVisible()
      expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument()
      expect(screen.getByText(/do not have a useful explanation/)).toBeVisible()
    })

    it('always leaves a way out', async () => {
      renderThrowing(new TypeError('boom'))

      expect(await screen.findByRole('link', { name: 'Back to the start' }))
        .toHaveAttribute('href', '/')
    })

    it('names the page in the title, so the tab and the announcer agree', async () => {
      renderThrowing(new ApiError(500, 'Nope', null))
      await screen.findByRole('heading', { level: 1, name: 'Something went wrong' })

      expect(document.title).toBe('Something went wrong · tabstop')
    })
  })
})
