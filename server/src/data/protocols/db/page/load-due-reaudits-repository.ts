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
  /**
   * How far back an unfinished audit still counts as work in progress.
   *
   * Without a floor here, one `queued` row that no job will ever run removes
   * its page from every future night, silently and permanently - the audit
   * stays in flight forever because nothing is left to finish it. Bounding the
   * window makes the worklist self-healing instead: the row stops hiding the
   * page, and the day-scoped unique index still prevents a duplicate.
   */
  inFlightSince: Date
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
   * One batch of pages with monitoring on that have neither a recent audit in
   * flight nor one created since `dayStart`, ordered by id.
   *
   * Batched rather than fetched whole: a scheduler whose memory use is
   * "however many rows matched" fails on the night the product succeeds. The
   * caller pages until the batches run out, so the bound is on memory rather
   * than on how many pages get monitored.
   */
  loadDueForReaudit: (query: DuePageQuery) => Promise<DuePage[]>
}
