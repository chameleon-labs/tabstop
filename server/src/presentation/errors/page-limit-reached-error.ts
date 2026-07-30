export class PageLimitReachedError extends Error {
  constructor (limit: number) {
    super(`You're already tracking ${limit} pages, the maximum during the beta`)
    this.name = 'PageLimitReachedError'
  }
}
