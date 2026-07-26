export type SiteModel = {
  id: string
  /** Null until #10 introduces the users table and tightens this to NOT NULL. */
  userId: string | null
  domain: string
  createdAt: Date
}
