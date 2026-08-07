import type {ZodType} from 'zod';
import type {Validation, ValidationResult} from '../../presentation/protocols/validation.js';

/**
 * The only file in the codebase that imports zod. Schemas are declared beside
 * the controllers that own them and passed in here, so no zod type ever
 * reaches domain/ or data/ - the protocol is the boundary, not a decoration.
 */
export class ZodValidationAdapter<T> implements Validation<T> {
  constructor(private readonly schema: ZodType<T>) {}

  validate(input: unknown): ValidationResult<T> {
    const result = this.schema.safeParse(input);
    if (result.success) return {data: result.data};

    const message = result.error.issues
      .map((issue) => {
        const path = issue.path.join('.');
        return path === '' ? issue.message : `${path}: ${issue.message}`;
      })
      .join('; ');

    return {error: new Error(message)};
  }
}
