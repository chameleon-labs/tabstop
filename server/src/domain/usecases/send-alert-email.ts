export type SendAlertEmailOutcome = 'sent' | 'previewed' | 'failed' | 'skipped'

export interface SendAlertEmail {
  send: (alertEventId: string) => Promise<SendAlertEmailOutcome>
}
