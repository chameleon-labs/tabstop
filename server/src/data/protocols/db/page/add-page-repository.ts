import type { AuditModel } from '../../../../domain/models/audit.js'
import type { PageModel } from '../../../../domain/models/page.js'

export type AddPageRepositoryParams = {
  userId: string
  /** The host the page is grouped under. Its `Site` is created if absent. */
  domain: string
  /** Already canonicalised. The repository stores what it is given. */
  url: string
  /**
   * How many pages this account may hold, passed in rather than known here so
   * #35's per-plan quotas change a factory and not this file.
   */
  limit: number
}

/**
 * Four things happen and they have to happen together: the cap is checked, the
 * `Site` is found or created, the `Page` is inserted, and its first audit row
 * is written. Split across separate repository calls the cap stops being a cap
 * - two concurrent adds both count nine and both insert - and a page can end
 * up with no audit at all.
 *
 * So this is one call rather than a unit of work threaded through several. The
 * transaction is an implementation detail of the adapter, which keeps the
 * database handle out of every other layer.
 *
 * The audit is returned rather than enqueued here. Enqueueing inside the
 * transaction would leave the queue holding work for a page that rolls back,
 * so the caller does it afterwards.
 */
export type AddPageRepositoryResult =
  | { outcome: 'added', page: PageModel, firstAudit: AuditModel }
  | { outcome: 'limit-reached' }
  | { outcome: 'duplicate' }

export interface AddPageRepository {
  add: (params: AddPageRepositoryParams) => Promise<AddPageRepositoryResult>
}
