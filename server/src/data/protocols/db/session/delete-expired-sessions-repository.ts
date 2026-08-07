export interface DeleteExpiredSessionsRepository {
  /**
   * Removes every session whose expiry has passed, and reports how many.
   *
   * Expiry is already enforced where sessions are READ, so this changes no
   * authorisation outcome - it exists because a row that is merely harmless is
   * still a row, and one per login with nothing ever removing them is
   * unbounded growth.
   *
   * The count is returned for the log rather than for a caller to branch on:
   * a sweep that starts reporting thousands is the signal that something else
   * changed, and a silent maintenance task is one nobody notices has stopped.
   */
  deleteExpired: () => Promise<number>;
}
