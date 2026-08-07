export interface DeleteSessionRepository {
  /** Deleting an unknown id is not an error. */
  deleteById: (sessionId: string) => Promise<void>;
}
