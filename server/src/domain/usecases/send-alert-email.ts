export type SendAlertEmailOutcome = 'sent' | 'previewed' | 'skipped'

export interface SendAlertEmail {
  send: (alertEventId: string) => Promise<SendAlertEmailOutcome>
}
