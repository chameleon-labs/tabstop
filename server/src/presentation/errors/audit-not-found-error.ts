export class AuditNotFoundError extends Error {
  constructor () {
    super('No audit found for that id')
    this.name = 'AuditNotFoundError'
  }
}
