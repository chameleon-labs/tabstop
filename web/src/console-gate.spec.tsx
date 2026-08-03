import { render, screen } from '@testing-library/react'
import { Component, useEffect, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { ApiError } from './api/client'

/**
 * Tests for the gate in `vitest.setup.ts` - the one piece of test
 * infrastructure nothing else can check, because it lives in an `afterEach` and
 * a test cannot observe its own verdict.
 *
 * `it.fails` is how that is squared: it inverts the outcome, so a test here
 * PASSES when the gate correctly fails it, and starts failing the moment the
 * gate stops noticing. That is precisely the regression to guard against.
 */
describe('the console gate', () => {
  it.fails('fails a test that writes to console.error', () => {
    console.error('a stray error')
  })

  it.fails('fails a test that writes to console.warn', () => {
    console.warn('a stray warning')
  })

  it.fails('fails a test whose component logs while UNMOUNTING', () => {
    // The case that escaped. `cleanup()` used to run in its own `afterEach`,
    // and vitest unwinds those in reverse - so the assertion, registered
    // second, ran FIRST and restored the console before anything unmounted.
    // Nothing logging from an effect teardown was ever seen.
    //
    // Not a corner case: an effect that fails to clear a timer or drop a
    // subscription warns exactly here, which is the bug class most worth
    // catching without anyone having to read a log.
    const LogsOnUnmount = (): React.JSX.Element => {
      useEffect(() => () => { console.warn('logged while unmounting') }, [])
      return <p>mounted</p>
    }

    render(<LogsOnUnmount />)
  })

  it('lets an error a boundary CATCHES through, since specs cause those on purpose', () => {
    // The other half of the design. A gate that failed on these would make
    // every error-boundary spec unwritable; the filtering is what keeps the
    // failing above affordable.
    const Boom = (): React.JSX.Element => { throw new ApiError(404, 'Not found', null) }

    render(<Boundary><Boom /></Boundary>)

    // Reaching this line at all is the assertion: React logged the caught
    // error, and the gate let it through instead of failing this test.
    expect(screen.getByText('caught it')).toBeVisible()
  })
})

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError (): { failed: boolean } {
    return { failed: true }
  }

  override render (): ReactNode {
    return this.state.failed ? <p>caught it</p> : this.props.children
  }
}
