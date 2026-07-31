import { describe, expect, it, vi } from 'vitest'
import type {
  AlertUnsubscribeTokenCodec
} from '../../protocols/cryptography/alert-unsubscribe-token-codec.js'
import type {
  DisablePageAlertsRepository
} from '../../protocols/db/alert-event/disable-page-alerts-repository.js'
import { DbUnsubscribePageAlerts } from './unsubscribe-page-alerts.js'

describe('DbUnsubscribePageAlerts', () => {
  it('disables alerts for the authenticated page token', async () => {
    const tokens: AlertUnsubscribeTokenCodec = {
      encode: vi.fn(),
      decode: vi.fn().mockReturnValue('42')
    }
    const pages: DisablePageAlertsRepository = {
      disablePageAlerts: vi.fn().mockResolvedValue(true)
    }

    await expect(new DbUnsubscribePageAlerts(tokens, pages).unsubscribe('token'))
      .resolves.toBe(true)
    expect(pages.disablePageAlerts).toHaveBeenCalledWith('42')
  })

  it('does not touch storage for a tampered token', async () => {
    const tokens: AlertUnsubscribeTokenCodec = {
      encode: vi.fn(),
      decode: vi.fn().mockReturnValue(null)
    }
    const pages: DisablePageAlertsRepository = {
      disablePageAlerts: vi.fn()
    }

    await expect(new DbUnsubscribePageAlerts(tokens, pages).unsubscribe('tampered'))
      .resolves.toBe(false)
    expect(pages.disablePageAlerts).not.toHaveBeenCalled()
  })
})
