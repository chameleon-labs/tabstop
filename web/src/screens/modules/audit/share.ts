export const sharePathFor = (auditId: string): string => `/r/${encodeURIComponent(auditId)}`;

export const shareUrlFor = (auditId: string, origin: string): string =>
  new URL(sharePathFor(auditId), origin).toString();

export type AuditOrigin = {startedHere: true; pollAfterMs?: number};

export const startedHere = (pollAfterMs?: number): AuditOrigin =>
  pollAfterMs === undefined ? {startedHere: true} : {startedHere: true, pollAfterMs};

export const pollAfterMsFrom = (state: unknown): number | undefined => {
  if (typeof state !== 'object' || state === null || !('pollAfterMs' in state)) {
    return undefined;
  }
  const {pollAfterMs} = state;
  return typeof pollAfterMs === 'number' && Number.isFinite(pollAfterMs) && pollAfterMs > 0 ? pollAfterMs : undefined;
};

export const startedHereFrom = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'startedHere' in state && state.startedHere === true;
