export const ANNOUNCE_DELAY_MS = 100;

const listeners = new Set<() => void>();

export const documentTitleSet = (): void => {
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
