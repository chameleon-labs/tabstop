import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderAt } from '../../test/render'

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
