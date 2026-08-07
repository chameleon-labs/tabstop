import {describe, expect, it, vi} from 'vitest';
import * as mailProtocol from '../../protocols/mail/alert-sender.js';
import type {
  AlertDelivery,
  LoadAlertDeliveryRepository,
} from '../../protocols/db/alert-event/load-alert-delivery-repository.js';
import type {MarkAlertEmailedRepository} from '../../protocols/db/alert-event/mark-alert-emailed-repository.js';
import type {MarkAlertFailedRepository} from '../../protocols/db/alert-event/mark-alert-failed-repository.js';
import type {ClaimAlertPreviewRepository} from '../../protocols/db/alert-event/claim-alert-preview-repository.js';
import type {AlertDispatchMode} from '../../protocols/db/alert-event/load-pending-alert-events-repository.js';
import {AlertRateLimitError, PermanentAlertDeliveryError, type AlertSender} from '../../protocols/mail/alert-sender.js';
import type {AlertUnsubscribeTokenCodec} from '../../protocols/cryptography/alert-unsubscribe-token-codec.js';
import {DbSendAlertEmail} from './send-alert-email.js';

type AlertRepository = LoadAlertDeliveryRepository &
  MarkAlertEmailedRepository &
  ClaimAlertPreviewRepository &
  MarkAlertFailedRepository;

const delivery: AlertDelivery = {
  eventId: '12',
  pageId: '34',
  kind: 'score_drop',
  recipient: 'person@example.test',
  pageUrl: 'https://example.test/checkout',
  current: {
    publicUuid: '22222222-2222-4222-8222-222222222222',
    score: 72,
    violations: [
      {
        ruleId: 'label',
        impact: 'critical',
        description: 'Form elements must have labels',
        nodeCount: 3,
      },
    ],
  },
  previous: {
    score: 84,
    violations: [],
  },
  alertsEnabled: true,
  emailedAt: null,
  previewedAt: null,
  failedAt: null,
};

const onePointDelivery: AlertDelivery = {
  ...delivery,
  current: {
    ...delivery.current,
    score: 83,
  },
};

const setup = (
  overrides: Partial<{
    loaded: AlertDelivery | null;
    send: AlertSender['send'];
    mark: MarkAlertEmailedRepository['markAlertEmailed'];
    claimPreview: ClaimAlertPreviewRepository['claimAlertPreview'];
    markFailed: MarkAlertFailedRepository['markAlertFailed'];
    mode: AlertDispatchMode;
  }> = {},
) => {
  const repository: AlertRepository = {
    loadAlertDelivery: vi.fn().mockResolvedValue(overrides.loaded === undefined ? delivery : overrides.loaded),
    markAlertEmailed: overrides.mark ?? vi.fn().mockResolvedValue(true),
    claimAlertPreview: overrides.claimPreview ?? vi.fn().mockResolvedValue(true),
    markAlertFailed: overrides.markFailed ?? vi.fn().mockResolvedValue(true),
  };
  const sender: AlertSender = {
    send: overrides.send ?? vi.fn().mockResolvedValue('accepted'),
  };
  const tokens: AlertUnsubscribeTokenCodec = {
    encode: vi.fn().mockReturnValue('signed-token'),
    decode: vi.fn(),
  };
  const clock = vi.fn().mockReturnValue(new Date('2026-07-30T12:00:00Z'));
  const sut = new DbSendAlertEmail(
    repository,
    sender,
    tokens,
    'Tabstop <alerts@alerts.tabstop.dev>',
    'https://app.tabstop.dev',
    'https://api.tabstop.dev',
    overrides.mode ?? 'delivery',
    clock,
  );
  return {sut, repository, sender, tokens};
};

describe('DbSendAlertEmail', () => {
  it('exposes permanent and rate-limit delivery errors with stable details', () => {
    const permanentError = Reflect.get(mailProtocol, 'PermanentAlertDeliveryError');
    const rateLimitError = Reflect.get(mailProtocol, 'AlertRateLimitError');

    expect(permanentError).toEqual(expect.any(Function));
    expect(rateLimitError).toEqual(expect.any(Function));

    expect(Reflect.construct(permanentError, ['resend:403:invalid_api_key'])).toMatchObject({
      reason: 'resend:403:invalid_api_key',
    });
    expect(Reflect.construct(rateLimitError, [30_000])).toMatchObject({retryAfterMs: 30_000});
  });

  it('sends the regression detail and marks the event only after acceptance', async () => {
    const calls: string[] = [];
    const {sut, sender, repository} = setup({
      send: vi.fn((): Promise<'accepted'> => {
        calls.push('send');
        return Promise.resolve('accepted');
      }),
      mark: vi.fn(() => {
        calls.push('mark');
        return Promise.resolve(true);
      }),
    });

    await expect(sut.send('12')).resolves.toBe('sent');

    expect(calls).toEqual(['send', 'mark']);
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'person@example.test',
        subject: 'example.test/checkout dropped 12 points (84 → 72)',
        text: expect.stringContaining('critical — Form elements must have labels (3 elements)'),
        headers: {
          'List-Unsubscribe': '<https://api.tabstop.dev/api/alerts/unsubscribe/signed-token>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        idempotencyKey: 'alert-event/12',
      }),
    );
    expect(repository.markAlertEmailed).toHaveBeenCalledWith('12', new Date('2026-07-30T12:00:00Z'));
  });

  it('uses singular score grammar for a one-point regression', async () => {
    const {sut, sender} = setup({loaded: onePointDelivery});

    await sut.send('12');

    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'example.test/checkout dropped 1 point (84 → 83)',
      }),
    );
  });

  it('leaves emailed_at untouched when the provider fails', async () => {
    const {sut, repository} = setup({
      send: vi.fn().mockRejectedValue(new Error('provider unavailable')),
    });

    await expect(sut.send('12')).rejects.toThrow('provider unavailable');
    expect(repository.markAlertEmailed).not.toHaveBeenCalled();
    expect(repository.markAlertFailed).not.toHaveBeenCalled();
  });

  it('does not send an event that no longer exists', async () => {
    const {sut, sender} = setup({loaded: null});

    await expect(sut.send('12')).resolves.toBe('skipped');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('persists only permanent provider rejections', async () => {
    const permanent = setup({
      send: vi.fn().mockRejectedValue(new PermanentAlertDeliveryError('resend:451:unavailable_for_legal_reasons')),
    });
    const rateLimited = setup({
      send: vi.fn().mockRejectedValue(new AlertRateLimitError(30_000)),
    });

    await expect(permanent.sut.send('12')).resolves.toBe('failed');
    expect(permanent.repository.markAlertFailed).toHaveBeenCalledWith(
      '12',
      new Date('2026-07-30T12:00:00Z'),
      'resend:451:unavailable_for_legal_reasons',
    );
    expect(permanent.repository.markAlertEmailed).not.toHaveBeenCalled();

    await expect(rateLimited.sut.send('12')).rejects.toThrow('Alert delivery rate limited for 30000ms');
    expect(rateLimited.repository.markAlertFailed).not.toHaveBeenCalled();
  });

  it('does not send an event that was already delivered', async () => {
    const {sut, sender} = setup({
      loaded: {...delivery, emailedAt: new Date('2026-07-30T11:00:00Z')},
    });

    await expect(sut.send('12')).resolves.toBe('skipped');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('does not send an event that was permanently rejected', async () => {
    const {sut, sender} = setup({
      loaded: {...delivery, failedAt: new Date('2026-07-30T11:00:00Z')},
    });

    await expect(sut.send('12')).resolves.toBe('skipped');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('does not send after alerts for the page were disabled', async () => {
    const {sut, sender} = setup({
      loaded: {...delivery, alertsEnabled: false},
    });

    await expect(sut.send('12')).resolves.toBe('skipped');
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('records console previews without claiming the event was emailed', async () => {
    const {sut, repository, sender} = setup({
      send: vi.fn().mockResolvedValue('previewed'),
      mode: 'preview',
    });

    await expect(sut.send('12')).resolves.toBe('previewed');
    expect(sender.send).toHaveBeenCalledOnce();
    expect(repository.claimAlertPreview).toHaveBeenCalledWith('12', new Date('2026-07-30T12:00:00Z'));
    expect(repository.markAlertEmailed).not.toHaveBeenCalled();
  });

  it('skips an already previewed event in preview mode', async () => {
    const {sut, sender} = setup({
      loaded: {...delivery, previewedAt: new Date('2026-07-30T11:00:00Z')},
      mode: 'preview',
    });

    await expect(sut.send('12')).resolves.toBe('skipped');

    expect(sender.send).not.toHaveBeenCalled();
  });

  it('sends an already previewed event in delivery mode', async () => {
    const {sut, sender} = setup({
      loaded: {...delivery, previewedAt: new Date('2026-07-30T11:00:00Z')},
      mode: 'delivery',
    });

    await expect(sut.send('12')).resolves.toBe('sent');

    expect(sender.send).toHaveBeenCalledOnce();
  });

  it('renders before and after values for an existing rule that became worse', async () => {
    const {sut, sender} = setup({
      loaded: {
        ...delivery,
        current: {
          ...delivery.current,
          violations: [
            {
              ruleId: 'label',
              impact: 'critical',
              description: 'Form elements must have labels',
              nodeCount: 3,
            },
          ],
        },
        previous: {
          ...delivery.previous,
          violations: [
            {
              ruleId: 'label',
              impact: 'serious',
              description: 'Form elements must have labels',
              nodeCount: 1,
            },
          ],
        },
      },
    });

    await sut.send('12');

    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('serious → critical — Form elements must have labels (1 → 3 elements)'),
      }),
    );
  });
});
