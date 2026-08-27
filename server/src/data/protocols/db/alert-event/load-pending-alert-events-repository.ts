export type AlertDispatchMode = 'preview' | 'delivery';

export interface LoadPendingAlertEventsRepository {
  loadPendingAlertEventIds: (afterId: string | null, limit: number, mode: AlertDispatchMode) => Promise<string[]>;
}
