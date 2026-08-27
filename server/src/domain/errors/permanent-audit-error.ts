export class PermanentAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentAuditError';
  }
}
