import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { Layout } from '.'

const renderLayout = (): void => {
  const router = createMemoryRouter([{
    path: '/',
    element: <Layout />,
    children: [{ index: true, element: <h1>A screen</h1> }]
  }], { initialEntries: ['/'] })

  render(<RouterProvider router={router} />)
}

/** A screen that brings its own header, main and footer - as the landing page does. */
const renderOwnChrome = (): void => {
  const router = createMemoryRouter([{
    path: '/',
    element: <Layout />,
    children: [{
      index: true,
      handle: { ownChrome: true },
      element: (
        <div>
          <header><a href="/">a wordmark</a></header>
          <main id="main" tabIndex={-1}><h1>A screen</h1></main>
          <footer>a footer</footer>
        </div>
      )
    }]
  }], { initialEntries: ['/'] })

  render(<RouterProvider router={router} />)
}

describe('Layout', () => {
  describe('when a screen brings its own chrome', () => {
    it('steps back, leaving exactly one of each landmark', async () => {
      // The shell's header plus the screen's own produced two `banner`
      // landmarks and two "tabstop" wordmarks, and the shell's `<main>` wrapped
      // the screen's into a `<main>` inside a `<main>` - which is invalid, and
      // gives the skip link two `#main` candidates to choose between.
      renderOwnChrome()
      await screen.findByRole('heading', { level: 1, name: 'A screen' })

      expect(screen.getAllByRole('banner')).toHaveLength(1)
      expect(screen.getAllByRole('main')).toHaveLength(1)
      expect(screen.getAllByRole('contentinfo')).toHaveLength(1)
      expect(document.querySelectorAll('#main')).toHaveLength(1)
    })

    it('keeps the skip link, which stays the shell\'s job either way', async () => {
      // The screen supplies the landmarks; it does not supply the escape from
      // them. Dropping this with the header would take the skip link off the
      // one screen with the most chrome to skip.
      renderOwnChrome()
      await screen.findByRole('heading', { level: 1, name: 'A screen' })

      expect(screen.getByRole('link', { name: 'Skip to content' }))
        .toHaveAttribute('href', '#main')
    })
  })

  it('renders the matched screen into the shell', async () => {
    renderLayout()

    expect(await screen.findByRole('heading', { level: 1, name: 'A screen' })).toBeVisible()
  })

  describe('the skip link', () => {
    it('is the first thing a keyboard reaches', async () => {
      // The entire point. If anything in the header comes first, a keyboard
      // user tabs through the whole navigation on every page to reach content,
      // and the link may as well not exist.
      renderLayout()

      await userEvent.tab()

      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus()
    })

    it('points at a target that exists', async () => {
      // A skip link to a missing id is worse than none: it looks like an
      // affordance and silently does nothing.
      renderLayout()

      const link = screen.getByRole('link', { name: 'Skip to content' })
      const href = link.getAttribute('href') ?? ''

      expect(href).toBe('#main')
      expect(document.querySelector(href)).toBe(screen.getByRole('main'))
    })

    it('targets an element that can actually take focus', async () => {
      // Without `tabIndex={-1}` the browser scrolls to `#main` but leaves focus
      // where it was, so the next Tab starts from the top of the page again -
      // the link appears to work and does not.
      renderLayout()

      expect(screen.getByRole('main')).toHaveAttribute('tabindex', '-1')
    })
  })

  it('gives the navigation an accessible name', async () => {
    // A landmark with no name is one of several identical "navigation" entries
    // in a screen reader's landmark list.
    renderLayout()

    expect(screen.getByRole('navigation', { name: 'Main' })).toBeVisible()
  })

  it('carries the route announcer, since only the shell renders once', async () => {
    // It has to persist ACROSS navigations. Mounted per screen, the region
    // would be new each time and a new region's content is initial content -
    // announced by nothing.
    renderLayout()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('offers a way home from every page', async () => {
    renderLayout()

    expect(screen.getByRole('link', { name: 'tabstop' })).toHaveAttribute('href', '/')
  })
})
