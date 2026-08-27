export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

export const IMPACTS: readonly Impact[] = ['minor', 'moderate', 'serious', 'critical'];

export type CountsByImpact = Record<Impact, number>;
