import { RateLimitError } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlertRateLimitError } from '../../data/protocols/mail/alert-sender.js'
import { makeAlertEmailJobProcessor } from './alert-email-job-processor.js'

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void

  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('makeAlertEmailJobProcessor', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs dispatch summaries for dispatch jobs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const dispatch = vi.fn(async () => ({ processed: 3 }))
    const send = vi.fn(async () => 'sent' as const)
    const rateLimit = vi.fn(async () => {})
    const process = makeAlertEmailJobProcessor({ dispatch, send, rateLimit })

    await process({ data: { kind: 'dispatch' }, attemptsMade: 0 })

    expect(dispatch).toHaveBeenCalledOnce()
    expect(send).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(JSON.stringify({
      event: 'alert-email-dispatch',
      processed: 3
    }))
  })

  it('waits for the retry delay before throwing BullMQ RateLimitError on provider rate limiting', async () => {
    const retryDelay = createDeferred<void>()
    const dispatch = vi.fn(async () => ({ processed: 0 }))
    const send = vi.fn(async () => { throw new AlertRateLimitError(7_000) })
    const rateLimit = vi.fn(() => retryDelay.promise)
    const process = makeAlertEmailJobProcessor({ dispatch, send, rateLimit })
    const processing = process({
      data: { kind: 'send', alertEventId: 'alert-1' },
      attemptsMade: 0
    })
    let settlement: 'pending' | 'resolved' | 'rejected' = 'pending'

    processing.then(
      () => {
        settlement = 'resolved'
      },
      () => {
        settlement = 'rejected'
      }
    )

    await flushMicrotasks()

    expect(settlement).toBe('pending')
    expect(rateLimit).toHaveBeenCalledOnce()
    expect(rateLimit).toHaveBeenCalledWith(7_000)

    retryDelay.resolve()

    await expect(processing).rejects.toBeInstanceOf(RateLimitError)
    expect(settlement).toBe('rejected')
  })

  it('propagates ordinary transient send failures unchanged', async () => {
    const transient = new Error('provider unavailable')
    const dispatch = vi.fn(async () => ({ processed: 0 }))
    const send = vi.fn(async () => { throw transient })
    const rateLimit = vi.fn(async () => {})
    const process = makeAlertEmailJobProcessor({ dispatch, send, rateLimit })

    await expect(process({
      data: { kind: 'send', alertEventId: 'alert-2' },
      attemptsMade: 0
    })).rejects.toBe(transient)
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('completes terminal failed outcomes and logs them truthfully', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const dispatch = vi.fn(async () => ({ processed: 0 }))
    const send = vi.fn(async () => 'failed' as const)
    const rateLimit = vi.fn(async () => {})
    const process = makeAlertEmailJobProcessor({ dispatch, send, rateLimit })

    await expect(process({
      data: { kind: 'send', alertEventId: 'alert-3' },
      attemptsMade: 1
    })).resolves.toBeUndefined()

    expect(log).toHaveBeenCalledWith(JSON.stringify({
      event: 'alert-email-send',
      alertEventId: 'alert-3',
      outcome: 'failed',
      attempt: 2
    }))
  })
})
