export type ValidationResult<T> = {data: T} | {error: Error};

export interface Validation<T> {
  validate: (input: unknown) => ValidationResult<T>;
}
