export type AlertEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  headers: {
    'List-Unsubscribe': string;
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click';
  };
  /**
   * Stable for one AlertEvent. Providers that accepted a request before the
   * worker lost the reply can return the original result instead of mailing
   * the recipient twice.
   */
  idempotencyKey: string;
};

export type AlertSendResult = 'accepted' | 'previewed';

export class PermanentAlertDeliveryError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

export class AlertRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Alert delivery rate limited for ${retryAfterMs}ms`);
  }
}

export interface AlertSender {
  /**
   * `accepted` means a real provider confirmed the request. `previewed` is
   * deliberately distinct so the local console adapter can never cause
   * emailed_at to claim a message left the process.
   */
  send: (email: AlertEmail) => Promise<AlertSendResult>;
}
