/**
 * A page the nightly run should audit, with the domain its jitter is keyed on.
 *
 * The domain rather than the page's own url, because politeness is per origin:
 * every page tabstop tracks on one host has to be spread out relative to the
 * others, and a per-page key would give them independent offsets that happen
 * to collide.
 */
export type DuePage = {
  pageId: string
  url: string
  domain: string
}

export interface LoadDueReauditsRepository {
  /**
   * Pages with monitoring on that have neither an audit in flight nor one
   * created since `dayStart`.
   *
   * `limit` bounds the run. v1 caps an account at ten pages, so nothing is
   * near it - but a scheduler whose memory use is "however many rows matched"
   * fails at the worst moment, which is the night the product succeeds.
   */
  loadDueForReaudit: (dayStart: Date, limit: number) => Promise<DuePage[]>
}
