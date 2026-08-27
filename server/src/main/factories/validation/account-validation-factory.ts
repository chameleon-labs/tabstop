import {z} from 'zod';
import {ZodValidationAdapter} from '../../../infra/validation/zod-validation-adapter.js';
import type {AddAccountParams} from '../../../domain/usecases/add-account.js';
import type {AuthenticateParams} from '../../../domain/usecases/authenticate.js';
import type {Validation} from '../../../presentation/protocols/validation.js';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

const email = z
  .string()
  .trim()
  .pipe(z.email())
  .transform((value) => value.toLowerCase());

const signupSchema = z.object({
  email,
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
});

const loginSchema = z.object({
  email,
  password: z.string().min(1),
});

export const makeSignupValidation = (): Validation<AddAccountParams> =>
  new ZodValidationAdapter<AddAccountParams>(signupSchema);

export const makeLoginValidation = (): Validation<AuthenticateParams> =>
  new ZodValidationAdapter<AuthenticateParams>(loginSchema);
