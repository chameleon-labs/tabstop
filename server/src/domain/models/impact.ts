export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

/** Iteration order for normalising counts. Must cover every Impact member. */
export const IMPACTS: readonly Impact[] = ['minor', 'moderate', 'serious', 'critical'];

export type CountsByImpact = Record<Impact, number>;
