import type { AlertEmail, AlertSender } from '../../data/protocols/mail/alert-sender.js'

export class ResendAlertSender implements AlertSender {
  constructor (
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 10_000
  ) {}

  async send (email: AlertEmail): Promise<'accepted'> {
    const response = await this.fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': email.idempotencyKey
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        from: email.from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        headers: email.headers
      })
    })

    if (!response.ok) {
      throw new Error(`Resend rejected alert email with ${response.status}`)
    }

    const result: unknown = await response.json()
    if (typeof result !== 'object' || result === null ||
        !('id' in result) || typeof result.id !== 'string') {
      throw new Error('Resend returned no email id')
    }
    return 'accepted'
  }
}
