export interface DeletePageRepository {
  /**
   * Both ids, for the same reason as SetPageMonitoringRepository: a
   * single-argument delete would be one forgotten `where` away from removing
   * somebody else's page.
   *
   * False when this account has no such page, including a malformed id.
   */
  deleteForUser: (pageId: string, userId: string) => Promise<boolean>
}
