import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderAt } from '../../test/render'
import { RouteAnnouncer } from '.'
import { useDocumentTitle } from '../../hooks/use-document-title'

/**
 * The gap this closes: a full page load announces the new document, a
 * client-side route change announces nothing, and a screen reader user
 * activates a link and hears silence.
 */
describe('the route announcer', () => {
  /**
   * The SHELL's region, which comes first in the document. The home screen now
   * carries a second one for audit status, so an unscoped query matches both.
   */
  const liveRegion = (): HTMLElement => screen.getAllByRole('status')[0] as HTMLElement

  it('stays quiet on first load, which the browser has already announced', async () => {
    renderAt('/')

    await screen.findByRole('heading', { level: 1 })
    // Long enough for the deferred announcement to have fired if it were going
    // to. An assertion made immediately would pass whether or not it was.
    await new Promise((resolve) => setTimeout(resolve, 250))

    expect(liveRegion()).toHaveTextContent('')
  })

  it('names the new page after a navigation', async () => {
    renderAt('/nope')
    await screen.findByRole('heading', { level: 1, name: 'Page not found' })

    await userEvent.click(screen.getByRole('link', { name: 'Back to the start' }))

    // The home screen's own title, not the 404's - so the announcement is read
    // after the destination has named itself, not before.
    await waitFor(() => { expect(liveRegion()).toHaveTextContent('tabstop') })
    expect(liveRegion()).not.toHaveTextContent('Page not found')
  })

  it('announces once when the destination names itself late', async () => {
    // Driven through a router of its own, because the real screens all set
    // their title fast enough to take the observer path - which is exactly the
    // case that does NOT reproduce this. A slow screen sets it AFTER the
    // deadline, and a version that announced on schedule and corrected
    // afterwards left assistive technology reading two announcements for one
    // navigation. So this counts mutations, not the text they settle on.
    // Names itself LATE, the way a screen does when the one it replaced was
    // expensive to unmount.
    const Named = (): null => { useDocumentTitle('Late page'); return null }
    const SlowScreen = (): React.JSX.Element => {
      const [ready, setReady] = useState(false)
      useEffect(() => {
        const timer = setTimeout(() => { setReady(true) }, 300)
        return () => { clearTimeout(timer) }
      }, [])
      return <>{ready && <Named />}<h1>Late page</h1></>
    }

    // One announcer, above the routes, the way the shell mounts it. Rendering
    // one per route remounts it on navigation, and a fresh announcer seeds
    // itself with the current path and correctly says nothing.
    const router = createMemoryRouter([{
      path: '/',
      element: <><RouteAnnouncer /><Outlet /></>,
      children: [
        { index: true, element: <h1>Start</h1> },
        { path: 'late', element: <SlowScreen /> }
      ]
    }], { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)

    const region = screen.getByRole('status')
    const seen: string[] = []
    const observer = new MutationObserver(() => { seen.push(region.textContent ?? '') })
    observer.observe(region, { childList: true, characterData: true, subtree: true })

    await act(async () => { await router.navigate('/late') })
    await waitFor(() => { expect(region).toHaveTextContent('Late page') })
    // Long enough after the announcement for a correction to have landed, if
    // the implementation were still making one.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)) })
    observer.disconnect()

    expect(seen.filter((text) => text !== '')).toEqual(['Late page · tabstop'])
  })

  it('announces again when two paths share a title', async () => {
    // `/pages/1` and `/pages/2` are both "Page · tabstop". Writing the same
    // string back into state is a no-op to React, so the DOM never changes, a
    // live region with unchanged content has nothing to read, and the second
    // navigation is announced by silence - the exact failure this component
    // exists to fix, reintroduced by it.
    //
    // Asserted on DOM MUTATIONS rather than on the final text, because the
    // final text is identical either way. Mutation is what assistive
    // technology reacts to, so mutation is what to measure.
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: '1', email: 'a@b.co', alertThreshold: 5 }), {
        status: 200, headers: { 'content-type': 'application/json' }
      })))

    try {
      // Starts at `/` and navigates TWICE. Landing directly on `/pages/1`
      // announces nothing - correctly, the browser already named the initial
      // page - so the first navigation is what gets "Page" into the region and
      // the second is the one under test.
      const { router } = renderAt('/')
      await act(async () => { await router.navigate('/pages/1') })
      await waitFor(() => { expect(liveRegion()).toHaveTextContent('Page') })

      const seen: string[] = []
      const observer = new MutationObserver(() => { seen.push(liveRegion().textContent ?? '') })
      observer.observe(liveRegion(), { childList: true, characterData: true, subtree: true })

      await act(async () => { await router.navigate('/pages/2') })
      await waitFor(() => { expect(liveRegion()).toHaveTextContent('Page') })
      observer.disconnect()

      // Emptied, then filled again. Without the clear there is no mutation at
      // all and `seen` is empty.
      expect(seen).toContain('')
      expect(seen.at(-1)).toContain('Page')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the region mounted and empty while there is nothing to say', () => {
    // A live region created at the moment it gets content is treated as
    // initial content and announced by nothing. It has to already be there.
    renderAt('/')

    expect(liveRegion()).toBeInTheDocument()
    expect(liveRegion()).toBeEmptyDOMElement()
  })
})
