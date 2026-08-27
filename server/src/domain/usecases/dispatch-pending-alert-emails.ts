export type AlertEmailDispatchSummary = {
  processed: number;
};

export interface DispatchPendingAlertEmails {
  dispatch: () => Promise<AlertEmailDispatchSummary>;
}
