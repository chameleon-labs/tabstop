const MAX_BIGINT = 9223372036854775807n;

/**
 * Postgres rejects a non-`bigint` (SQLSTATE 22P03, or 22003 on overflow)
 * rather than returning zero rows, so an id from a url path is checked first.
 * A value that cannot BE an id is a miss, not an error - which is what keeps
 * `Promise<Model | null>` honest and the database's type checking from
 * becoming a 500.
 *
 * Shared rather than defined per repository: every route that takes an id from
 * a path needs it, and a second copy of the bound is a second chance to get it
 * wrong.
 */
export const isStorableId = (value: string): boolean => /^\d{1,19}$/.test(value) && BigInt(value) <= MAX_BIGINT;
