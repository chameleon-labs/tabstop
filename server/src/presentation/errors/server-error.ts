export class ServerError extends Error {
  constructor (cause?: Error) {
    super('Internal server error')
    this.name = 'ServerError'
    this.cause = cause
  }
}
