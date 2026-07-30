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

export type DuePageQuery = {
  /** Midnight UTC of the run's day. A page audited since is not due again. */
  dayStart: Date
  limit: number
  /**
   * Keyset cursor - the last page id of the previous batch, or null to start.
   *
   * Keyset rather than an offset because the run MUTATES what it is paging
   * over: every page it schedules gains an audit in flight and drops out of
   * the predicate, so an offset would skip as many pages as the previous batch
   * scheduled.
   */
  after: string | null
}

export interface LoadDueReauditsRepository {
  /**
   * One batch of pages with monitoring on that have neither an audit in flight
   * nor one created since `dayStart`, ordered by id.
   *
   * An unfinished audit excludes its page however old it is. Ageing them out
   * instead would compound under load: on a queue that has not drained, real
   * pending audits would be read as abandoned and their pages scheduled again,
   * so every night would add work the workers were already behind on. Rows
   * that are genuinely abandoned are reclaimed by confirming them against the
   * queue, which is a different question and lives elsewhere.
   *
   * Batched rather than fetched whole: a scheduler whose memory use is
   * "however many rows matched" fails on the night the product succeeds. The
   * caller pages until the batches run out, so the bound is on memory rather
   * than on how many pages get monitored.
   */
  loadDueForReaudit: (query: DuePageQuery) => Promise<DuePage[]>
}
