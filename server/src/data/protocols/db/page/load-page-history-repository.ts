import type { PageHistory } from '../../../../domain/usecases/load-page-history.js'

export interface LoadPageHistoryRepository {
  /**
   * The page and its audits from `since` onwards, oldest first.
   *
   * Takes an instant rather than a day count on purpose: turning a window into
   * a boundary is policy, and policy belongs in the usecase. A repository
   * accepting `days` would own the default and the cap as well, which is how
   * a second caller ends up with a different ceiling than the first.
   *
   * Both ids, as with every other page method - null is "this account has no
   * such page", which is deliberately the same answer as "no such page".
   */
  loadHistoryForUser: (
    pageId: string, userId: string, since: Date
  ) => Promise<PageHistory | null>
}
