export type DeletePageParams = {
  pageId: string
  userId: string
}

export interface DeletePage {
  /**
   * False when this account has no such page, including when somebody else
   * does.
   *
   * Deleting a page cascades to its audits, their violations and their alert
   * events, so every public share link for that page's audits stops resolving.
   * That is the intended privacy behaviour, tested in #4 - and it is why there
   * is no undo.
   */
  delete: (params: DeletePageParams) => Promise<boolean>
}
