import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuditProgress } from '.'

describe('AuditProgress', () => {
  it('shows the phase it was given', () => {
    render(<AuditProgress phase="Fetching the page" />)

    expect(screen.getByText(/Fetching the page/)).toBeVisible()
  })

  it('sets the expectation, because thirty seconds is a long time', () => {
    render(<AuditProgress phase="Scoring" />)

    expect(screen.getByText(/this usually takes about 30 seconds/)).toBeVisible()
  })

  it('renders nothing when there is no phase', () => {
    const { container } = render(<AuditProgress phase={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('owns no live region', () => {
    // It appears already knowing its first phase, and a region mounted with
    // content in it is initial content - announced by nothing. It also
    // unmounts exactly when the result arrives, taking any chance to say so.
    // `AuditAnnouncer` owns the region instead.
    render(<AuditProgress phase="Fetching the page" />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
