export type AlertDispatchMode = 'preview' | 'delivery'

export interface LoadPendingAlertEventsRepository {
  /**
   * Keyset page of unsent ids whose page still permits alerts, ascending. The
   * dispatcher walks every page so an old provider failure cannot hold newer
   * alerts behind a fixed LIMIT.
   */
  loadPendingAlertEventIds: (
    afterId: string | null,
    limit: number,
    mode: AlertDispatchMode
  ) => Promise<string[]>
}
