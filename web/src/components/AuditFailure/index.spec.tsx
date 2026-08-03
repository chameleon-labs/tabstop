import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AuditFailure } from '.'
import type { DescribedFailure } from '../../audit/failure'
import { Providers } from '../../test/render'

const show = (failure: DescribedFailure): { onRetry: ReturnType<typeof vi.fn> } => {
  const onRetry = vi.fn()
  render(<Providers><AuditFailure failure={failure} onRetry={onRetry} /></Providers>)
  return { onRetry }
}

describe('AuditFailure', () => {
  it('shows the sentence the server wrote, rather than one of its own', () => {
    // Eight of these exist server-side, written for a person. A ninth table
    // here would drift the first time either side is reworded.
    show({ message: 'Could not resolve that domain', action: 'retry' })

    expect(screen.getByText('Could not resolve that domain')).toBeVisible()
  })

  it('interrupts, because it replaces something being waited on', () => {
    // The one place in this flow where interrupting is right: a question was
    // asked thirty seconds ago and the answer is that it failed.
    show({ message: 'boom', action: 'retry' })

    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })

  describe('retry', () => {
    it('offers a button that re-runs the same URL', async () => {
      const { onRetry } = show({ message: 'The page took too long to load', action: 'retry' })

      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

      expect(onRetry).toHaveBeenCalledOnce()
    })
  })

  describe('check-url', () => {
    it('does not offer a retry that is guaranteed to fail identically', async () => {
      // A 400 is a property of the URL. A button that cannot work is worse than
      // no button.
      show({ message: "That address can't be audited", action: 'check-url' })

      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
      expect(screen.getByText(/Check the address/)).toBeVisible()
    })
  })

  describe('the rate limit, which is not an error', () => {
    const limited: DescribedFailure = {
      message: 'Too many requests',
      action: 'signup',
      rateLimit: { error: 'Too many requests', retryAfter: 45, resetAt: '2026-08-03T10:00:00Z' }
    }

    it('reads as an offer rather than a failure', async () => {
      // Someone who has audited enough pages to exhaust the anonymous limit has
      // demonstrated the product's value more convincingly than any landing
      // page could. Framing that as a failure would be the most expensive copy
      // in the app.
      show(limited)

      expect(screen.getByRole('heading', { level: 2 }))
        .toHaveTextContent('You have used your free audits')
      expect(screen.getByRole('link', { name: 'Create an account' })).toBeVisible()
    })

    it('still says how long the wait is', async () => {
      // An offer that hides the free alternative is a dark pattern, and this
      // product cannot afford one.
      show(limited)

      expect(screen.getByText(/wait 45 seconds/)).toBeVisible()
    })

    it('omits the wait when the server did not give a usable one', async () => {
      show({ message: 'Too many requests', action: 'signup' })

      expect(screen.queryByText(/wait/)).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Create an account' })).toBeVisible()
    })
  })

  describe('none', () => {
    it('offers nothing rather than inventing an affordance', () => {
      show({ message: 'Forbidden', action: 'none' })

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
      expect(screen.getByText('Forbidden')).toBeVisible()
    })
  })
})
