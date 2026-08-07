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
export const ANNOUNCE_DELAY_MS = 100;

/**
 * Signals that a screen has named the document.
 *
 * The announcer cannot get this from the DOM. A title that has not changed
 * since navigation is either a screen that has not run yet or one whose title
 * matches the previous page - `/pages/1` and `/pages/2` are both "Page" - and
 * the two need opposite handling while looking identical. Waiting on a
 * deadline picks wrong for whichever case it was not tuned for: too short and
 * a slow screen is announced by the name of the page being LEFT, too long and
 * every navigation is announced late.
 *
 * So the screen says so instead of the announcer guessing.
 */
const listeners = new Set<() => void>();

export const documentTitleSet = (): void => {
  for (const listener of [...listeners]) listener();
};

export const onDocumentTitleSet = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
