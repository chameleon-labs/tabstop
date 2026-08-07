export interface JobQueue<TPayload> {
  enqueue: (payload: TPayload) => Promise<void>;
}
