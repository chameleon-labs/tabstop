export type AlertEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  headers: {
    'List-Unsubscribe': string;
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click';
  };
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
  send: (email: AlertEmail) => Promise<AlertSendResult>;
}
