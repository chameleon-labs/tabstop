import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Home } from '.'

describe('Home', () => {
  it('leads with what the product does', () => {
    render(<Home />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Paste a URL')
  })

  it('is the site itself, so the tab says only the site name', () => {
    // The one screen with an empty title. `· tabstop` with nothing in front of
    // it would read as a bug, and the route announcer reads this same string.
    render(<Home />)

    expect(document.title).toBe('tabstop')
  })
})
