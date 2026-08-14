export const sharePathFor = (auditId: string): string => `/r/${encodeURIComponent(auditId)}`;

export const shareUrlFor = (auditId: string, origin: string): string =>
  new URL(sharePathFor(auditId), origin).toString();

export type AuditOrigin = {startedHere: true};

export const startedHere = (): AuditOrigin => ({startedHere: true});

export const startedHereFrom = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'startedHere' in state && state.startedHere === true;
