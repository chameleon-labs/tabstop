import { describe, expect, it, vi } from 'vitest'
import { JobTimeoutError, runWithTimeout } from './run-with-timeout.js'

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

describe('runWithTimeout', () => {
  it('resolves with the handler result when it finishes in time', async () => {
    const result = await runWithTimeout(1000, async () => 'done')

    expect(result).toBe('done')
  })

  it('rejects with JobTimeoutError when the handler runs over budget', async () => {
    await expect(
      runWithTimeout(20, async () => { await sleep(1000) })
    ).rejects.toBeInstanceOf(JobTimeoutError)
  })

  it('aborts the signal it handed the handler, so the handler can stop its own work', async () => {
    let observed: boolean | null = null

    await expect(
      runWithTimeout(20, async (signal) => {
        await sleep(1000)
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
