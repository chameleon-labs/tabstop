/**
 * Validation parses rather than checks: it returns the typed value, so a
 * controller never has to cast `unknown` to the shape it hoped for. A
 * `(input: unknown) => Error | null` protocol would leave that cast in place,
 * which under this repo's strict settings is an unchecked assertion dressed up
 * as verification.
 */
export type ValidationResult<T> = { data: T } | { error: Error }

export interface Validation<T> {
  validate: (input: unknown) => ValidationResult<T>
}
