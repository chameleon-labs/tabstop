import {describe, expect, it, vi} from 'vitest';
import {
  AlertRateLimitError,
  PermanentAlertDeliveryError,
  type AlertEmail,
} from '../../data/protocols/mail/alert-sender.js';
import {ResendAlertSender} from './resend-alert-sender.js';

const message: AlertEmail = {
  from: 'Tabstop <alerts@alerts.tabstop.dev>',
  to: 'person@example.test',
  subject: 'example.test dropped 8 points (90 → 82)',
  text: 'Something got worse.',
  headers: {
    'List-Unsubscribe': '<https://api.tabstop.dev/api/alerts/unsubscribe/token>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
  idempotencyKey: 'alert-event/123',
};

const rejectedError = async (sender: ResendAlertSender): Promise<unknown> => {
  try {
    await sender.send(message);
  } catch (error) {
    return error;
  }
  throw new Error('expected Resend to reject the alert email');
};

type ResponseHeaders = Record<string, string>;

const rejectedResponse = (status: number, body: unknown, headers?: ResponseHeaders): Response =>
  new Response(JSON.stringify(body), headers === undefined ? {status} : {status, headers});

describe('ResendAlertSender', () => {
  it('sends plain text with unsubscribe headers and an idempotency key', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({id: 'email-id'}), {status: 200, headers: {'content-type': 'application/json'}}),
      );
    const sut = new ResendAlertSender('re_test', fetcher);

    await sut.send(message);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer re_test',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'alert-event/123',
      },
      signal: expect.any(AbortSignal),
      body: JSON.stringify({
        from: message.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        headers: message.headers,
      }),
    });
  });

  it.each([
    [400, 'validation_error'],
    [401, 'missing_api_key'],
    [403, 'invalid_api_key'],
    [404, 'not_found'],
    [405, 'method_not_allowed'],
    [418, 'unknown_client_error'],
    [422, 'invalid_from_address'],
    [451, 'unavailable_for_legal_reasons'],
    [409, 'invalid_idempotent_request'],
    [429, 'monthly_quota_exceeded'],
  ])('classifies Resend %i %s as a permanent rejection', async (status, name) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(status, {
        name,
        message: 'provider detail that must not be persisted',
      }),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toBeInstanceOf(PermanentAlertDeliveryError);
    expect(error).toMatchObject({reason: `resend:${status}:${name}`});
  });

  it.each([
    {value: {value: 'validation_error'}, label: 'a non-string name'},
    {value: 'Invalid_Name', label: 'a noncanonical name'},
    {value: `a${'a'.repeat(64)}`, label: 'an overlong name'},
    {value: 'validation_error\u0000untrusted', label: 'a control-character name'},
  ])('uses a bounded reason for $label', async ({value}) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(400, {
        name: value,
        message: 'provider detail that must not be persisted',
      }),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toMatchObject({reason: 'resend:400:http_error'});
    expect(error).not.toMatchObject({reason: expect.stringContaining(String(value))});
    if (!(error instanceof PermanentAlertDeliveryError)) {
      throw new Error('expected a permanent delivery error');
    }
    expect(error.reason.length).toBeLessThan(100);
  });

  it('keeps concurrent idempotency conflicts retryable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(409, {
        name: 'concurrent_idempotent_requests',
      }),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentAlertDeliveryError);
    expect(error).not.toBeInstanceOf(AlertRateLimitError);
  });

  it('keeps unclassified 429 responses retryable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(429, {
        name: 'unexpected_quota_error',
      }),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentAlertDeliveryError);
    expect(error).not.toBeInstanceOf(AlertRateLimitError);
  });

  it('keeps server failures retryable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(500, {
        name: 'internal_server_error',
      }),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PermanentAlertDeliveryError);
    expect(error).not.toBeInstanceOf(AlertRateLimitError);
  });

  it('uses Retry-After seconds for rate-limit delays', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(
        429,
        {
          name: 'rate_limit_exceeded',
        },
        {'retry-after': '7'},
      ),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toBeInstanceOf(AlertRateLimitError);
    expect(error).toMatchObject({retryAfterMs: 7_000});
  });

  it.each([
    [{'retry-after': 'tomorrow', 'ratelimit-reset': '2'}, 2_000],
    [{'retry-after': 'tomorrow', 'ratelimit-reset': 'later'}, 1_000],
    [{}, 1_000],
  ])('uses a validated reset header or one-second fallback for rate limits', async (headers, retryAfterMs) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(
        429,
        {
          name: 'rate_limit_exceeded',
        },
        headers,
      ),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toMatchObject({retryAfterMs});
  });

  it.each([
    ['0', 1_000],
    ['999999999', 86_400_000],
  ])('clamps rate-limit Retry-After %s to %i milliseconds', async (retryAfter, retryAfterMs) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(
        429,
        {
          name: 'rate_limit_exceeded',
        },
        {'retry-after': retryAfter},
      ),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toMatchObject({retryAfterMs});
  });

  it('uses a 24-hour fallback for the daily quota', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(429, {
        name: 'daily_quota_exceeded',
      }),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toBeInstanceOf(AlertRateLimitError);
    expect(error).toMatchObject({retryAfterMs: 86_400_000});
  });

  it('uses Retry-After seconds for the daily quota delay', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      rejectedResponse(
        429,
        {
          name: 'daily_quota_exceeded',
        },
        {'retry-after': '7'},
      ),
    );

    const error = await rejectedError(new ResendAlertSender('re_test', fetcher));

    expect(error).toBeInstanceOf(AlertRateLimitError);
    expect(error).toMatchObject({retryAfterMs: 7_000});
  });

  it('does not treat a malformed success response as confirmed delivery', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({}), {status: 200, headers: {'content-type': 'application/json'}}),
      );

    await expect(new ResendAlertSender('re_test', fetcher).send(message)).rejects.toThrow(
      'Resend returned no email id',
    );
  });
});
