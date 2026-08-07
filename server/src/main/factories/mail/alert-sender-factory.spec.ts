import {describe, expect, it} from 'vitest';
import {ConsoleAlertSender} from '../../../infra/mail/console-alert-sender.js';
import {ResendAlertSender} from '../../../infra/mail/resend-alert-sender.js';
import {makeAlertSender} from './alert-sender-factory.js';

describe('makeAlertSender', () => {
  it('uses the non-delivering console adapter unless Resend is explicitly selected', () => {
    expect(makeAlertSender({mailDriver: 'console', resendApiKey: null})).toBeInstanceOf(ConsoleAlertSender);
  });

  it('builds Resend only when both the driver and key are present', () => {
    expect(makeAlertSender({mailDriver: 'resend', resendApiKey: 're_test'})).toBeInstanceOf(ResendAlertSender);
    expect(() => makeAlertSender({mailDriver: 'resend', resendApiKey: null})).toThrow('RESEND_API_KEY');
  });
});
