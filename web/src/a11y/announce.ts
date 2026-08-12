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
  // A snapshot, so a listener that unsubscribes - or subscribes another -
  // during dispatch cannot change who this pass notifies.
  for (const listener of Array.from(listeners)) {
    listener();
  }
};

export const onDocumentTitleSet = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
