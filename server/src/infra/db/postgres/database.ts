import type {ColumnType, Generated} from 'kysely';
import type {AlertKind} from '../../../domain/models/alert-event.js';
import type {AuditStatus} from '../../../domain/models/audit.js';
import type {CountsByImpact, Impact} from '../../../domain/models/impact.js';
import type {ViolationNode} from '../../../domain/models/violation.js';

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

type Json<T> = ColumnType<T, string | undefined, string>;

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_digest: string;
  alert_threshold: Generated<number>;
  created_at: Generated<Date>;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface SitesTable {
  id: Generated<string>;
  user_id: string;
  domain: string;
  created_at: Generated<Date>;
}

export interface PagesTable {
  id: Generated<string>;
  site_id: string;
  url: string;
  monitoring_enabled: Generated<boolean>;
  alerts_enabled: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface OnDemandAuditsTable {
  id: Generated<string>;
  user_id: string;
  spent_on: ColumnType<Date, string, string>;
  audit_id: Nullable<string>;
  created_at: Generated<Date>;
}

export interface AuditsTable {
  id: Generated<string>;
  public_uuid: Generated<string>;
  page_id: Nullable<string>;
  url: string;
  status: AuditStatus;
  score: Nullable<number>;
  counts_by_impact: Json<CountsByImpact>;
  axe_version: Nullable<string>;
  duration_ms: Nullable<number>;
  error: Nullable<string>;
  created_at: Generated<Date>;
  completed_at: Nullable<Date>;
  settled: Generated<boolean>;
  claimed_at: Nullable<Date>;
  scheduled_for: ColumnType<Date | null, string | null | undefined, string | null>;
}

export interface ViolationsTable {
  id: Generated<string>;
  audit_id: string;
  rule_id: string;
  impact: Nullable<Impact>;
  description: string;
  help_url: string;
  nodes: Json<ViolationNode[]>;
}

export interface AlertEventsTable {
  id: Generated<string>;
  page_id: string;
  audit_id: string;
  previous_audit_id: Nullable<string>;
  kind: AlertKind;
  created_at: Generated<Date>;
  emailed_at: Nullable<Date>;
  previewed_at: Nullable<Date>;
  failed_at: Nullable<Date>;
  failure_reason: Nullable<string>;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  sites: SitesTable;
  pages: PagesTable;
  audits: AuditsTable;
  on_demand_audits: OnDemandAuditsTable;
  violations: ViolationsTable;
  alert_events: AlertEventsTable;
}
