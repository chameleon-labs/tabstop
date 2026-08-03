import { act, render, screen, waitFor } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuditAnnouncer } from '.'
import { ANNOUNCE_DELAY_MS } from '../../a11y/announce'

const region = (): HTMLElement => screen.getByRole('status')

describe('AuditAnnouncer', () => {
  it('mounts EMPTY, even when it already has something to say', async () => {
    // The whole reason this is its own component. A region whose text is
    // present at the moment it appears is treated as initial content and
    // announced by nothing - so the progress indicator, which appeared already
    // knowing its first phase, never spoke that phase at all.
    //
    // Asserted on the FIRST RENDER's output rather than on the mounted DOM,
    // because `render` wraps in `act` and flushes the effect.
    //
    // This proves only that REACT commits an empty region. It does not prove
    // that assistive technology observed one, which is a separate question
    // answered by the deferral below - a passive effect can run before the
    // browser has painted or exposed the node.
    const initial = renderToStaticMarkup(<AuditAnnouncer message="Requesting the audit" />)

    expect(initial).toContain('role="status"')
    expect(initial).not.toContain('Requesting the audit')

    render(<AuditAnnouncer message="Requesting the audit" />)
    await waitFor(() => { expect(region()).toHaveTextContent('Requesting the audit') })
  })

  describe('the write is deferred, not merely effect-scheduled', () => {
    afterEach(() => { vi.useRealTimers() })

    it('leaves the region empty until a later task', () => {
      // Rendering empty is necessary and NOT sufficient. A passive effect can
      // run before the browser has painted or exposed the new node, so writing
      // from `useEffect` directly would still deliver the first message as
      // initial content - announced by nothing, and the first message is the
      // one this component exists for.
      vi.useFakeTimers()

      render(<AuditAnnouncer message="Requesting the audit" />)

      expect(region()).toBeEmptyDOMElement()

      act(() => { vi.advanceTimersByTime(ANNOUNCE_DELAY_MS) })
      expect(region()).toHaveTextContent('Requesting the audit')
    })
  })

  it('is polite, because none of this should interrupt', () => {
    render(<AuditAnnouncer message="Scoring" />)

    expect(region()).toHaveAttribute('aria-live', 'polite')
  })

  it('stays mounted while there is nothing to say', () => {
    // It has to exist BEFORE the first message and AFTER the last, which is
    // what makes both the first phase and the completion announceable.
    render(<AuditAnnouncer message={null} />)

    expect(region()).toBeInTheDocument()
    expect(region()).toBeEmptyDOMElement()
  })

  it('does not clear itself when the message goes null', async () => {
    // Completion arrives and the progress phase stops. Emptying the region at
    // that moment would announce nothing and erase what was just said.
    const { rerender } = render(<AuditAnnouncer message="Scoring" />)
    await waitFor(() => { expect(region()).toHaveTextContent('Scoring') })

    rerender(<AuditAnnouncer message={null} />)

    expect(region()).toHaveTextContent('Scoring')
  })

  it('changes only when the message changes', async () => {
    // The screen re-renders once a second while an audit runs. A region
    // rewritten each time announces thirty times, each interrupting the last.
    const { rerender } = render(<AuditAnnouncer message="Scoring" />)
    await waitFor(() => { expect(region()).toHaveTextContent('Scoring') })

    const seen: string[] = []
    const drain = (records: MutationRecord[]): void => {
      for (const record of records) seen.push(record.oldValue ?? '')
    }
    const observer = new MutationObserver(drain)
    observer.observe(region(), {
      childList: true, characterData: true, characterDataOldValue: true, subtree: true
    })

    for (let i = 0; i < 5; i += 1) rerender(<AuditAnnouncer message="Scoring" />)
    drain(observer.takeRecords())
    observer.disconnect()

    expect(seen).toEqual([])
  })
})
