import { describe, expect, it, vi } from 'vitest'
import type {
  AlertDelivery, LoadAlertDeliveryRepository
} from '../../protocols/db/alert-event/load-alert-delivery-repository.js'
import type {
  MarkAlertEmailedRepository
} from '../../protocols/db/alert-event/mark-alert-emailed-repository.js'
import type { AlertSender } from '../../protocols/mail/alert-sender.js'
import type {
  AlertUnsubscribeTokenCodec
} from '../../protocols/cryptography/alert-unsubscribe-token-codec.js'
import { DbSendAlertEmail } from './send-alert-email.js'

const delivery: AlertDelivery = {
  eventId: '12',
  pageId: '34',
  kind: 'score_drop',
  recipient: 'person@example.test',
  pageUrl: 'https://example.test/checkout',
  current: {
    publicUuid: '22222222-2222-4222-8222-222222222222',
    score: 72,
    violations: [{
      ruleId: 'label',
      impact: 'critical',
      description: 'Form elements must have labels',
      nodeCount: 3
    }]
  },
  previous: {
    score: 84,
    violations: []
  },
  alertsEnabled: true,
  emailedAt: null,
  previewedAt: null,
  failedAt: null
}

const setup = (overrides: Partial<{
  loaded: AlertDelivery | null
  send: AlertSender['send']
  mark: MarkAlertEmailedRepository['markAlertEmailed']
}> = {}) => {
  const repository: LoadAlertDeliveryRepository & MarkAlertEmailedRepository = {
    loadAlertDelivery: vi.fn().mockResolvedValue(overrides.loaded ?? delivery),
    markAlertEmailed: overrides.mark ?? vi.fn().mockResolvedValue(true)
  }
  const sender: AlertSender = {
    send: overrides.send ?? vi.fn().mockResolvedValue('accepted')
  }
  const tokens: AlertUnsubscribeTokenCodec = {
    encode: vi.fn().mockReturnValue('signed-token'),
    decode: vi.fn()
  }
  const clock = vi.fn().mockReturnValue(new Date('2026-07-30T12:00:00Z'))
  const sut = new DbSendAlertEmail(
    repository, sender, tokens, 'Tabstop <alerts@alerts.tabstop.dev>',
    'https://app.tabstop.dev', 'https://api.tabstop.dev', clock
  )
  return { sut, repository, sender, tokens }
}

describe('DbSendAlertEmail', () => {
  it('sends the regression detail and marks the event only after acceptance', async () => {
    const calls: string[] = []
    const { sut, sender, repository } = setup({
      send: vi.fn(async (): Promise<'accepted'> => {
        calls.push('send')
        return 'accepted'
      }),
      mark: vi.fn(async () => {
        calls.push('mark')
        return true
      })
    })

    await expect(sut.send('12')).resolves.toBe('sent')

    expect(calls).toEqual(['send', 'mark'])
    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'person@example.test',
      subject: 'example.test/checkout dropped 12 points (84 → 72)',
      text: expect.stringContaining('critical — Form elements must have labels (3 elements)'),
      headers: {
        'List-Unsubscribe':
          '<https://api.tabstop.dev/api/alerts/unsubscribe/signed-token>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      },
      idempotencyKey: 'alert-event/12'
    }))
    expect(repository.markAlertEmailed).toHaveBeenCalledWith(
      '12', new Date('2026-07-30T12:00:00Z')
    )
  })

  it('leaves emailed_at untouched when the provider fails', async () => {
    const { sut, repository } = setup({
      send: vi.fn().mockRejectedValue(new Error('provider unavailable'))
    })

    await expect(sut.send('12')).rejects.toThrow('provider unavailable')
    expect(repository.markAlertEmailed).not.toHaveBeenCalled()
  })

  it('does not send an event that was already delivered', async () => {
    const { sut, sender } = setup({
      loaded: { ...delivery, emailedAt: new Date('2026-07-30T11:00:00Z') }
    })

    await expect(sut.send('12')).resolves.toBe('skipped')
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('does not send after alerts for the page were disabled', async () => {
    const { sut, sender } = setup({
      loaded: { ...delivery, alertsEnabled: false }
    })

    await expect(sut.send('12')).resolves.toBe('skipped')
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('previews through the console adapter without claiming the event was emailed', async () => {
    const repository: LoadAlertDeliveryRepository & MarkAlertEmailedRepository = {
      loadAlertDelivery: vi.fn().mockResolvedValue(delivery),
      markAlertEmailed: vi.fn()
    }
    const tokens: AlertUnsubscribeTokenCodec = {
      encode: vi.fn().mockReturnValue('signed-token'),
      decode: vi.fn()
    }
    const sender: AlertSender = {
      send: vi.fn().mockResolvedValue('previewed')
    }
    const sut = new DbSendAlertEmail(
      repository,
      sender,
      tokens,
      'Tabstop <alerts@alerts.tabstop.dev>',
      'https://app.tabstop.dev',
      'https://api.tabstop.dev'
    )

    await expect(sut.send('12')).resolves.toBe('previewed')
    expect(sender.send).toHaveBeenCalledOnce()
    expect(repository.markAlertEmailed).not.toHaveBeenCalled()
  })

  it('renders before and after values for an existing rule that became worse', async () => {
    const { sut, sender } = setup({
      loaded: {
        ...delivery,
        current: {
          ...delivery.current,
          violations: [{
            ruleId: 'label',
            impact: 'critical',
            description: 'Form elements must have labels',
            nodeCount: 3
          }]
        },
        previous: {
          ...delivery.previous,
          violations: [{
            ruleId: 'label',
            impact: 'serious',
            description: 'Form elements must have labels',
            nodeCount: 1
          }]
        }
      }
    })

    await sut.send('12')

    expect(sender.send).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining(
        'serious → critical — Form elements must have labels (1 → 3 elements)'
      )
    }))
  })
})
