/**
 * The answer for a page this account does not own, whether or not somebody
 * else does. A 403 would confirm the row exists; this deliberately cannot.
 */
export class PageNotFoundError extends Error {
  constructor () {
    super('No page found for that id')
    this.name = 'PageNotFoundError'
  }
}
