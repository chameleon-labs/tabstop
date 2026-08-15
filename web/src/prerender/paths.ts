import {join} from 'node:path';

export const PRERENDER_PATHS = ['/', '/docs/score-formula'] as const;

export const outputFor = (dist: string, path: string): string =>
  path === '/' ? join(dist, 'index.html') : join(dist, path, 'index.html');
