import type { PageModel } from '../models/page.js'
import type { UrlRejection } from '../services/url-safety.js'

export type AddPageParams = {
  userId: string
  url: string
}

/**
 * Four expected outcomes rather than exceptions for three of them, the same
 * shape RequestAudit uses. A bad url, an account at its cap and a page already
 * being tracked are all ordinary answers a user will see routinely; only a
 * database that will not answer is exceptional.
 */
export type AddPageResult =
  | {
    outcome: 'added'
    page: PageModel
    /**
     * The first audit's public uuid, so the client can watch it the same way
     * an anonymous submission does. Null when the page was created but the
     * queue would not accept the job - the page is genuinely tracked, and
     * pretending an audit is running would leave the dashboard showing "in
     * progress" for something nothing will ever pick up.
     */
    firstAuditId: string | null
  }
  | { outcome: 'rejected', reason: UrlRejection }
  | { outcome: 'limit-reached', limit: number }
  | { outcome: 'duplicate' }

export interface AddPage {
  add: (params: AddPageParams) => Promise<AddPageResult>
}
