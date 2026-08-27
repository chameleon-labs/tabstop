export const QUEUE_NAMES = {
  ping: 'ping',
  audit: 'audit',
  reaudit: 'reaudit',
  alertEmail: 'alert-email',
} as const;

export type PingPayload = {
  requestedAt: string;
};

export type AuditPayload = {
  auditId: string;
};

export type ReauditPayload = Record<string, never>;

export type AlertQueuePayload = {kind: 'dispatch'} | {kind: 'send'; alertEventId: string};
