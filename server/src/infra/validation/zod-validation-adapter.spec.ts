import {describe, expect, it} from 'vitest';
import {z} from 'zod';
import {ZodValidationAdapter} from './zod-validation-adapter.js';

type Input = {email: string; password: string};

const schema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(200),
});

const makeSut = (): ZodValidationAdapter<Input> => new ZodValidationAdapter<Input>(schema);

describe('ZodValidationAdapter', () => {
  it('returns the parsed value, normalised', () => {
    const result = makeSut().validate({email: '  A@Example.COM  ', password: 'a'.repeat(12)});

    expect(result).toEqual({data: {email: 'a@example.com', password: 'a'.repeat(12)}});
  });

  it('reports every failing field with its path', () => {
    const result = makeSut().validate({email: 'nope', password: 'short'});

    if (!('error' in result)) {
      throw new Error('expected a validation error');
    }
    expect(result.error.message).toContain('email');
    expect(result.error.message).toContain('password');
  });

  it('strips unknown keys, so a body cannot smuggle extra fields through', () => {
    const result = makeSut().validate({email: 'a@b.co', password: 'a'.repeat(12), userId: '99'});

    expect(result).toEqual({data: {email: 'a@b.co', password: 'a'.repeat(12)}});
  });

  it('rejects non-object input without throwing', () => {
    for (const input of [null, undefined, 'string', 42, []]) {
      expect('error' in makeSut().validate(input)).toBe(true);
    }
  });
});
