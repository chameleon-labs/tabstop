import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dashboard } from '.'

describe('Dashboard', () => {
  it('names itself as the page heading', () => {
    render(<Dashboard />)

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  })

  it('names itself in the title too, which is what the announcer reads', () => {
    render(<Dashboard />)

    expect(document.title).toBe('Dashboard · tabstop')
  })
})
