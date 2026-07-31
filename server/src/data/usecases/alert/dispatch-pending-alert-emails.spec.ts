import { describe, expect, it, vi } from 'vitest'
import type {
  LoadPendingAlertEventsRepository
} from '../../protocols/db/alert-event/load-pending-alert-events-repository.js'
import type {
  AlertEmailJobQueue
} from '../../protocols/queue/alert-email-job-queue.js'
import { DbDispatchPendingAlertEmails } from './dispatch-pending-alert-emails.js'

describe('DbDispatchPendingAlertEmails', () => {
  it('reports processed candidates without claiming each created queue work', async () => {
    const alerts: LoadPendingAlertEventsRepository = {
      loadPendingAlertEventIds: vi.fn()
        .mockResolvedValueOnce(['1', '2'])
        .mockResolvedValueOnce(['3'])
    }
    const queue: AlertEmailJobQueue = {
      enqueueOnce: vi.fn().mockResolvedValue(undefined)
    }
    const sut = new DbDispatchPendingAlertEmails(alerts, queue, 2)

    await expect(sut.dispatch()).resolves.toEqual({ processed: 3 })

    expect(alerts.loadPendingAlertEventIds).toHaveBeenNthCalledWith(
      1, null, 2, 'delivery'
    )
    expect(alerts.loadPendingAlertEventIds).toHaveBeenNthCalledWith(
      2, '2', 2, 'delivery'
    )
    expect(queue.enqueueOnce).toHaveBeenCalledTimes(3)
    expect(queue.enqueueOnce).toHaveBeenNthCalledWith(3, { alertEventId: '3' })
  })

  it('propagates an enqueue failure so BullMQ retries the dispatch', async () => {
    const alerts: LoadPendingAlertEventsRepository = {
      loadPendingAlertEventIds: vi.fn().mockResolvedValue(['1'])
    }
    const queue: AlertEmailJobQueue = {
      enqueueOnce: vi.fn().mockRejectedValue(new Error('redis unavailable'))
    }

    await expect(new DbDispatchPendingAlertEmails(alerts, queue).dispatch())
      .rejects.toThrow('redis unavailable')
  })
})
