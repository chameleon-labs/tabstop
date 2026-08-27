const MAX_BIGINT = 9223372036854775807n;

export const isStorableId = (value: string): boolean => /^\d{1,19}$/.test(value) && BigInt(value) <= MAX_BIGINT;
