import { describe, expect, it, vi } from 'vitest'
import type { AlertEmail } from '../../data/protocols/mail/alert-sender.js'
import { ResendAlertSender } from './resend-alert-sender.js'

const message: AlertEmail = {
  from: 'Tabstop <alerts@alerts.tabstop.dev>',
  to: 'person@example.test',
  subject: 'example.test dropped 8 points (90 → 82)',
  text: 'Something got worse.',
  headers: {
    'List-Unsubscribe': '<https://api.tabstop.dev/api/alerts/unsubscribe/token>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  },
  idempotencyKey: 'alert-event/123'
}

describe('ResendAlertSender', () => {
  it('sends plain text with unsubscribe headers and an idempotency key', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ id: 'email-id' }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ))
    const sut = new ResendAlertSender('re_test', fetcher)

    await sut.send(message)

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer re_test',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'alert-event/123'
      },
      signal: expect.any(AbortSignal),
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        headers: message.headers
      })
    })
  })

  it('rejects an error response so the job can retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ message: 'rate limited' }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    ))

    await expect(new ResendAlertSender('re_test', fetcher).send(message))
      .rejects.toThrow('Resend rejected alert email with 429')
  })

  it('does not treat a malformed success response as confirmed delivery', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({}),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ))

    await expect(new ResendAlertSender('re_test', fetcher).send(message))
      .rejects.toThrow('Resend returned no email id')
  })
})
