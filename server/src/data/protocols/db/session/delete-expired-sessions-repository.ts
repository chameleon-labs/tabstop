export interface DeleteExpiredSessionsRepository {
  deleteExpired: () => Promise<number>;
}
