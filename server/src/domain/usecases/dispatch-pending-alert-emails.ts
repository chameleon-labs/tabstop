export type AlertEmailDispatchSummary = {
  /** Candidates whose idempotent queue inspection completed successfully. */
  processed: number
}

export interface DispatchPendingAlertEmails {
  dispatch: () => Promise<AlertEmailDispatchSummary>
}
