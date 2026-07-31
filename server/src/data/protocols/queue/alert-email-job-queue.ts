export type AlertEmailJob = {
  alertEventId: string
}

export interface AlertEmailJobQueue {
  /** One queue record per AlertEvent, including when dispatch itself retries. */
  enqueueOnce: (job: AlertEmailJob) => Promise<void>
}
