import { describe, expect, it, vi } from 'vitest'
import type { AlertEmail } from '../../data/protocols/mail/alert-sender.js'
import { ConsoleAlertSender } from './console-alert-sender.js'

const message: AlertEmail = {
  from: 'Tabstop <alerts@alerts.example.test>',
  to: 'person@example.test',
  subject: 'A regression',
  text: 'Preview body',
  headers: {
    'List-Unsubscribe': '<https://api.example.test/unsubscribe/token>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  },
  idempotencyKey: 'alert-event/1'
}

describe('ConsoleAlertSender', () => {
  it('labels its output as a preview rather than provider acceptance', async () => {
    const write = vi.fn()

    await expect(new ConsoleAlertSender(write).send(message)).resolves.toBe('previewed')
    expect(JSON.parse(write.mock.calls[0]?.[0] ?? '')).toMatchObject({
      event: 'alert-email-console',
      to: message.to,
      idempotencyKey: message.idempotencyKey
    })
  })
})
