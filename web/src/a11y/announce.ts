/**
 * How long to wait before writing into a live region that has just appeared.
 *
 * A region must be in the accessibility tree, and empty, before text lands in
 * it - content present when the region is first observed is initial content,
 * and assistive technology says nothing about it. Rendering the region empty is
 * necessary and NOT sufficient: a passive effect can run before the browser has
 * painted or exposed the new node, so a write from `useEffect` can still arrive
 * as initial content. Deferring to a later task is what actually separates the
 * two events.
 *
 * Shared by both announcers rather than duplicated. `RouteAnnouncer` had this
 * reasoning first; `AuditAnnouncer` was written with the effect alone and
 * needed the same defer, which is exactly the sort of thing a copied constant
 * lets drift.
 *
 * Not tuning: short enough to be imperceptible, long enough to be a separate
 * task from the render that created the region.
 */
export const ANNOUNCE_DELAY_MS = 100
