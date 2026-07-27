import { z } from 'zod'
import { ZodValidationAdapter } from '../../../infra/validation/zod-validation-adapter.js'
import type { AddAccountParams } from '../../../domain/usecases/add-account.js'
import type { AuthenticateParams } from '../../../domain/usecases/authenticate.js'
import type { Validation } from '../../../presentation/protocols/validation.js'

const MIN_PASSWORD_LENGTH = 12
/**
 * Not a security limit - scrypt has no input ceiling, unlike bcrypt's 72 bytes.
 * It stops a multi-megabyte body from turning one request into unbounded work.
 */
const MAX_PASSWORD_LENGTH = 200

/**
 * trim() must run BEFORE the email check, not after. `z.email().transform(...)`
 * looks equivalent and is not: the format check runs first, so " a@b.co " is
 * rejected before anything can trim it. Verified.
 */
const email = z.string().trim().pipe(z.email()).transform((value) => value.toLowerCase())

const signupSchema = z.object({
  email,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH)
})

// Login must NOT enforce the password policy: a user whose password predates a
// policy change still has to be able to log in, and rejecting on length here
// would also tell an attacker which passwords are impossible.
const loginSchema = z.object({
  email,
  password: z.string().min(1)
})

export const makeSignupValidation = (): Validation<AddAccountParams> =>
  new ZodValidationAdapter<AddAccountParams>(signupSchema)

export const makeLoginValidation = (): Validation<AuthenticateParams> =>
  new ZodValidationAdapter<AuthenticateParams>(loginSchema)
