export type AlertKind = 'score_drop' | 'new_critical';

export type AlertEventModel = {
  id: string;
  pageId: string;
  auditId: string;
  previousAuditId: string | null;
  kind: AlertKind;
  createdAt: Date;
  emailedAt: Date | null;
};
