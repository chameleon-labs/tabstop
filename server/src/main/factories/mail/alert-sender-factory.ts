import type { AlertSender } from '../../../data/protocols/mail/alert-sender.js'
import { ConsoleAlertSender } from '../../../infra/mail/console-alert-sender.js'
import { ResendAlertSender } from '../../../infra/mail/resend-alert-sender.js'
import { env } from '../../config/env.js'

export type AlertSenderConfig = Pick<typeof env, 'mailDriver' | 'resendApiKey'>

export const makeAlertSender = (
  config: AlertSenderConfig = env
): AlertSender => {
  if (config.mailDriver === 'console') return new ConsoleAlertSender()
  if (config.resendApiKey === null) {
    throw new Error('RESEND_API_KEY is required when MAIL_DRIVER=resend')
  }
  return new ResendAlertSender(config.resendApiKey)
}
