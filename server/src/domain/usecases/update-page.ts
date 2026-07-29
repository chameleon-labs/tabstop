import type { PageModel } from '../models/page.js'

export type UpdatePageParams = {
  pageId: string
  userId: string
  monitoringEnabled: boolean
}

export interface UpdatePage {
  /**
   * Null when this account has no such page - including when somebody else
   * does. The caller cannot tell those apart, which is the point: a response
   * that distinguished them would confirm the row exists.
   */
  update: (params: UpdatePageParams) => Promise<PageModel | null>
}
