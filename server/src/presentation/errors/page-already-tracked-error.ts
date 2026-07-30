export class PageAlreadyTrackedError extends Error {
  constructor () {
    super('You are already tracking that page')
    this.name = 'PageAlreadyTrackedError'
  }
}
