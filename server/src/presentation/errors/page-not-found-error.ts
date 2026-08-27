export class PageNotFoundError extends Error {
  constructor() {
    super('No page found for that id');
    this.name = 'PageNotFoundError';
  }
}
