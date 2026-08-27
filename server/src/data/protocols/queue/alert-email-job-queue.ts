export type AlertEmailJob = {
  alertEventId: string;
};

export interface AlertEmailJobQueue {
  enqueueOnce: (job: AlertEmailJob) => Promise<void>;
}
