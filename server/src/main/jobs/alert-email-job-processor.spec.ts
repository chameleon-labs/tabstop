import { RateLimitError } from 'bullmq'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AlertRateLimitError } from '../../data/protocols/mail/alert-sender.js'
import { makeAlertEmailJobProcessor } from './alert-email-job-processor.js'

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

  it('applies the retry delay and throws BullMQ RateLimitError on provider rate limiting', async () => {
    const dispatch = vi.fn(async () => ({ processed: 0 }))
    const send = vi.fn(async () => { throw new AlertRateLimitError(7_000) })
    const rateLimit = vi.fn(async () => {})
    const process = makeAlertEmailJobProcessor({ dispatch, send, rateLimit })

    await expect(process({
      data: { kind: 'send', alertEventId: 'alert-1' },
      attemptsMade: 0
    })).rejects.toBeInstanceOf(RateLimitError)
    expect(rateLimit).toHaveBeenCalledWith(7_000)
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
