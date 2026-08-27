export interface DeleteSessionRepository {
  deleteById: (sessionId: string) => Promise<void>;
}
