import { act, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditStatus } from '.'
import { ANNOUNCE_DELAY_MS } from '../../a11y/announce'

const region = (): HTMLElement => screen.getByRole('status')

describe('AuditStatus', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const settle = (): void => { act(() => { vi.advanceTimersByTime(ANNOUNCE_DELAY_MS) }) }

  it('is ONE node, both seen and announced', () => {
    // Four attempts got here. A hidden region beside the visible sentence
    // announced what the sentence already said, so a screen reader met it
    // twice; merging them made it mount with content, which is announced by
    // nothing. One always-mounted node written to late satisfies both.
    render(<AuditStatus message="Fetching the page" />)
    settle()

    expect(screen.getAllByText(/Fetching the page/)).toHaveLength(1)
    expect(region()).toHaveTextContent('Fetching the page')
    expect(region()).toBeVisible()
  })

  it('renders empty, so the region exists before its first content', () => {
    // Proves only that REACT commits an empty region; whether assistive
    // technology observed one is the deferral below.
    const initial = renderToStaticMarkup(<AuditStatus message="Fetching the page" />)

    expect(initial).toContain('role="status"')
    expect(initial).not.toContain('Fetching the page')
  })

  it('defers the write to a later task', () => {
    // A passive effect can run before the browser has painted or exposed the
    // node, so an immediate write can still arrive as initial content.
    render(<AuditStatus message="Requesting the audit" />)

    expect(region()).toBeEmptyDOMElement()

    settle()
    expect(region()).toHaveTextContent('Requesting the audit')
  })

  it('stays mounted with nothing to say, before an audit and after one', () => {
    render(<AuditStatus message={null} />)

    expect(region()).toBeInTheDocument()
    expect(region()).toBeEmptyDOMElement()
  })

  it('does not erase what it just said when the message goes null', () => {
    // Completion arrives and the phase stops. Clearing then would announce
    // nothing and wipe the last thing said.
    const { rerender } = render(<AuditStatus message="Scoring" />)
    settle()

    rerender(<AuditStatus message={null} />)
    settle()

    expect(region()).toHaveTextContent('Scoring')
  })

  it('changes only when the message changes', () => {
    // The screen re-renders once a second while an audit runs. A region
    // rewritten each time announces thirty times, each interrupting the last.
    const { rerender } = render(<AuditStatus message="Scoring" />)
    settle()

    const seen: string[] = []
    const drain = (records: MutationRecord[]): void => {
      for (const record of records) seen.push(record.oldValue ?? '')
    }
    const observer = new MutationObserver(drain)
    observer.observe(region(), {
      childList: true, characterData: true, characterDataOldValue: true, subtree: true
    })

    for (let i = 0; i < 5; i += 1) rerender(<AuditStatus message="Scoring" />)
    settle()
    drain(observer.takeRecords())
    observer.disconnect()

    expect(seen).toEqual([])
  })

  it('is polite, because none of this should interrupt', () => {
    render(<AuditStatus message="Scoring" />)

    expect(region()).toHaveAttribute('aria-live', 'polite')
  })
})
