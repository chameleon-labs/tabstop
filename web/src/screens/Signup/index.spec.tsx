import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Signup } from '.'

describe('Signup', () => {
  it('names itself as the page heading', () => {
    render(<Signup />)

    expect(screen.getByRole('heading', { level: 1, name: 'Create an account' })).toBeVisible()
  })

  it('is honest that it is not built yet', () => {
    // A placeholder that pretends to be a form is worse than one that says so:
    // the visitor arriving here came from the rate limit and is deciding
    // whether this product is serious.
    render(<Signup />)

    expect(screen.getByText(/not open yet/)).toBeVisible()
  })

  it('names the page in the title', () => {
    render(<Signup />)

    expect(document.title).toBe('Create an account · tabstop')
  })
})
