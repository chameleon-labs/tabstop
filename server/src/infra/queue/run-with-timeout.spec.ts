import { describe, expect, it, vi } from 'vitest'
import { JobTimeoutError, runWithTimeout } from './run-with-timeout.js'

// A handler that hangs forever. Simulating one with a long sleep would leave a
// live timer behind after the timeout wins the race, and make the suite wait
// out a delay that proves nothing.
const hangs = async (): Promise<never> => await new Promise(() => { /* never settles */ })

describe('runWithTimeout', () => {
  it('resolves with the handler result when it finishes in time', async () => {
    const result = await runWithTimeout(1000, async () => 'done')

    expect(result).toBe('done')
  })

  it('rejects with JobTimeoutError when the handler runs over budget', async () => {
    await expect(
      runWithTimeout(20, hangs)
    ).rejects.toBeInstanceOf(JobTimeoutError)
  })

  it('aborts the signal it handed the handler, so the handler can stop its own work', async () => {
    let observed: boolean | null = null

    await expect(
      // Waiting on the abort event rather than a fixed delay also proves the
      // handler's own listener survives runWithTimeout's cleanup.
      runWithTimeout(20, async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => { resolve() }, { once: true })
        })
        observed = signal.aborted
      })
    ).rejects.toBeInstanceOf(JobTimeoutError)

    await vi.waitFor(() => { expect(observed).toBe(true) }, { timeout: 5000 })
  })

  it('propagates a handler error unchanged', async () => {
    await expect(
      runWithTimeout(1000, async () => { throw new Error('handler blew up') })
    ).rejects.toThrow('handler blew up')
  })

  it('does not abort the signal when the handler finishes in time', async () => {
    let observed: boolean | null = null

    await runWithTimeout(1000, async (signal) => {
      observed = signal.aborted
    })

    expect(observed).toBe(false)
  })
})
