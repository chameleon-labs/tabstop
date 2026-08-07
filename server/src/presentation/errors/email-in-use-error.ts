export class EmailInUseError extends Error {
  constructor() {
    super('This email is already registered');
    this.name = 'EmailInUseError';
  }
}
