import type {AlertEmail, AlertSender} from '../../data/protocols/mail/alert-sender.js';

export class ConsoleAlertSender implements AlertSender {
  constructor(private readonly write: (line: string) => void = console.log) {}

  send(email: AlertEmail): Promise<'previewed'> {
    this.write(
      JSON.stringify({
        event: 'alert-email-console',
        to: email.to,
        subject: email.subject,
        text: email.text,
        headers: email.headers,
        idempotencyKey: email.idempotencyKey,
      }),
    );
    return Promise.resolve('previewed');
  }
}
