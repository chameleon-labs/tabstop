export type SkeletonShape = 'dashboard' | 'detail' | 'form' | 'generic';

export const SKELETON_SHAPES: readonly (readonly [RegExp, SkeletonShape])[] = [
  [/^\/dashboard$/, 'dashboard'],
  [/^\/pages\/[^/]+$/, 'detail'],
  [/^\/(login|signup)$/, 'form'],
];

export const FALLBACK_SHAPE: SkeletonShape = 'generic';

export const trimTrailingSlash = (pathname: string): string =>
  pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

export const skeletonShapeFor = (pathname: string): SkeletonShape =>
  SKELETON_SHAPES.find(([pattern]) => pattern.test(trimTrailingSlash(pathname)))?.[1] ?? FALLBACK_SHAPE;

export const SKELETON_BLOCKS: Record<SkeletonShape, {head: readonly string[]; body: readonly string[]}> = {
  dashboard: {head: ['title', 'lede'], body: ['row', 'row', 'row']},
  detail: {head: ['meta', 'title', 'lede'], body: ['panel', 'chart']},
  form: {head: ['title', 'lede'], body: ['field', 'field', 'action']},
  generic: {head: ['title', 'lede'], body: ['panel']},
};
