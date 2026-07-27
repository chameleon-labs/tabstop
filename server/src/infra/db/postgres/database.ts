import type { ColumnType, Generated } from 'kysely'
import type { AlertKind } from '../../../domain/models/alert-event.js'
import type { AuditStatus } from '../../../domain/models/audit.js'
import type { CountsByImpact, Impact } from '../../../domain/models/impact.js'
import type { ViolationNode } from '../../../domain/models/violation.js'

/**
 * Nullable and omittable on insert. Kysely does not infer the second part from
 * `T | null` alone — a bare `string | null` column is required on every insert.
 */
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>

/**
 * jsonb: reads as a parsed value, but is WRITTEN as a JSON string.
 *
 * Passing a JS value straight through works for plain objects and silently
 * breaks for arrays — node-postgres serialises an array as a Postgres array
 * literal (`{...}`), which the jsonb parser rejects with
 * `invalid input syntax for type json`. Requiring a string on the insert side
 * removes the asymmetry: every jsonb write goes through JSON.stringify.
 */
type Json<T> = ColumnType<T, string | undefined, string>

export interface UsersTable {
  id: Generated<string>
  /** Lowercased by the repository before every write and lookup. */
  email: string
  password_digest: string
  /** Score points. Read by regression detection (#14). */
  alert_threshold: Generated<number>
  created_at: Generated<Date>
}

export interface SessionsTable {
  /** The cookie value: 32 random bytes as hex. Not a uuid — the format is ours. */
  id: string
  user_id: string
  created_at: Generated<Date>
  expires_at: Date
}

export interface SitesTable {
  id: Generated<string>
  user_id: string
  domain: string
  created_at: Generated<Date>
}

export interface PagesTable {
  id: Generated<string>
  site_id: string
  url: string
  monitoring_enabled: Generated<boolean>
  created_at: Generated<Date>
}

export interface AuditsTable {
  id: Generated<string>
  public_uuid: Generated<string>
  page_id: Nullable<string>
  url: string
  status: AuditStatus
  score: Nullable<number>
  counts_by_impact: Json<CountsByImpact>
  axe_version: Nullable<string>
  duration_ms: Nullable<number>
  error: Nullable<string>
  created_at: Generated<Date>
  completed_at: Nullable<Date>
  /** False when the page never reached network idle and was audited anyway. */
  settled: Generated<boolean>
}

export interface ViolationsTable {
  id: Generated<string>
  audit_id: string
  rule_id: string
  /** Null when axe reports a violation whose checks carry no severity. */
  impact: Nullable<Impact>
  description: string
  help_url: string
  nodes: Json<ViolationNode[]>
}

export interface AlertEventsTable {
  id: Generated<string>
  page_id: string
  audit_id: string
  previous_audit_id: Nullable<string>
  kind: AlertKind
  created_at: Generated<Date>
  emailed_at: Nullable<Date>
}

export interface Database {
  users: UsersTable
  sessions: SessionsTable
  sites: SitesTable
  pages: PagesTable
  audits: AuditsTable
  violations: ViolationsTable
  alert_events: AlertEventsTable
}
