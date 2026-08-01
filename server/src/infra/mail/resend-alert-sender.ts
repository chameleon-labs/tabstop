import {
  AlertRateLimitError, PermanentAlertDeliveryError, type AlertEmail, type AlertSender
} from '../../data/protocols/mail/alert-sender.js'

const MIN_RETRY_AFTER_MS = 1_000
const MAX_RETRY_AFTER_MS = 86_400_000
const DAILY_QUOTA_RETRY_AFTER_MS = 86_400_000

const responseName = (body: unknown): string | null =>
  typeof body === 'object' && body !== null && 'name' in body && typeof body.name === 'string'
    ? body.name
    : null

const providerNameForReason = (name: string | null): string =>
  name !== null && /^[a-z][a-z0-9_]{0,63}$/.test(name) ? name : 'http_error'

const secondsToMilliseconds = (value: string | null): number | null => {
  if (value === null || !/^\d+$/.test(value)) return null
  return Number(value) * 1_000
}

const clampRetryAfter = (retryAfterMs: number): number =>
  Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, retryAfterMs))

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
      const body: unknown = await response.json().catch(() => null)
      const name = responseName(body)
      if (response.status === 429 && name === 'rate_limit_exceeded') {
        const retryAfterMs = secondsToMilliseconds(response.headers.get('retry-after')) ??
          secondsToMilliseconds(response.headers.get('ratelimit-reset')) ?? MIN_RETRY_AFTER_MS
        throw new AlertRateLimitError(clampRetryAfter(retryAfterMs))
      }
      if (response.status === 429 && name === 'daily_quota_exceeded') {
        const retryAfterMs = secondsToMilliseconds(response.headers.get('retry-after')) ??
          DAILY_QUOTA_RETRY_AFTER_MS
        throw new AlertRateLimitError(clampRetryAfter(retryAfterMs))
      }
      if (response.status === 429 && name === 'monthly_quota_exceeded') {
        throw new PermanentAlertDeliveryError(
          `resend:${response.status}:${providerNameForReason(name)}`
        )
      }
      if (response.status === 429 ||
        (response.status === 409 && name === 'concurrent_idempotent_requests')) {
        throw new Error(`Resend rejected alert email with ${response.status}`)
      }
      if (response.status >= 400 && response.status < 500) {
        throw new PermanentAlertDeliveryError(
          `resend:${response.status}:${providerNameForReason(name)}`
        )
      }
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
