/**
 * One error for both an unknown email and a wrong password. Telling them apart
 * would turn the login form into an account-existence oracle.
 */
export class InvalidCredentialsError extends Error {
  constructor () {
    super('Invalid email or password')
    this.name = 'InvalidCredentialsError'
  }
}
