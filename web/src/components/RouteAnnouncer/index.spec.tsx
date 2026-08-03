import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderAt } from '../../test/render'

/**
 * The gap this closes: a full page load announces the new document, a
 * client-side route change announces nothing, and a screen reader user
 * activates a link and hears silence.
 */
describe('the route announcer', () => {
  const liveRegion = (): HTMLElement => screen.getByRole('status')

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

  it('keeps the region mounted and empty while there is nothing to say', () => {
    // A live region created at the moment it gets content is treated as
    // initial content and announced by nothing. It has to already be there.
    renderAt('/')

    expect(liveRegion()).toBeInTheDocument()
    expect(liveRegion()).toBeEmptyDOMElement()
  })
})
