export type AlertEmailDispatchSummary = {
  enqueued: number
}

export interface DispatchPendingAlertEmails {
  dispatch: () => Promise<AlertEmailDispatchSummary>
}
