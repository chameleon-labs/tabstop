import type { AuditModel } from '../models/audit.js'
import type { PageModel } from '../models/page.js'

export type LoadPageHistoryParams = {
  pageId: string
  userId: string
  /** Already defaulted and clamped by the time it reaches here. */
  days: number
}

export type PageHistory = {
  page: PageModel
  /**
   * Every audit in the window, oldest first, whatever became of each.
   *
   * `failed` runs are points too. Dropping them would make an outage look like
   * continuity, and scoring them 0 would make it look like a catastrophic
   * regression - a gap is the honest rendering, and "your site was unreachable
   * for three days" is exactly what a monitoring tool should be able to say.
   */
  audits: AuditModel[]
}

export interface LoadPageHistory {
  /** Null when this account has no such page, including when somebody else does. */
  load: (params: LoadPageHistoryParams) => Promise<PageHistory | null>
}
