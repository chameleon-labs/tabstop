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

describe('Layout', () => {
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
