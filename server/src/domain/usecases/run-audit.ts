export type RunAuditParams = {
  auditId: string
  /** Aborted when the job exceeds its budget; the auditor must kill the browser. */
  signal: AbortSignal
  /**
   * Whether this is the queue's last attempt. Supplied by the worker adapter,
   * because how many times a job may be retried is a property of the queue,
   * not of the domain - the usecase must not import the queue to find out.
   */
  isFinalAttempt: boolean
}

export interface RunAudit {
  run: (params: RunAuditParams) => Promise<void>
}
