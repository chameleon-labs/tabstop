/**
 * A failure that will recur identically on every retry - a domain that does not
 * resolve, a page that is not there, an engine that cannot run. The worker
 * adapter translates this into the queue's own "stop retrying" signal, which is
 * why the queue's type never has to reach the usecase.
 */
export class PermanentAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentAuditError';
  }
}
