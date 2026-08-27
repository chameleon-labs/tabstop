import {join} from 'node:path';

export type PrerenderedPage = {
  readonly path: string;
  readonly title?: string;
  readonly description?: string;
  readonly entry?: string;
};

export const PRERENDER_PAGES: readonly PrerenderedPage[] = [
  {path: '/'},
  {
    path: '/docs/score-formula',
    title: 'Score formula · tabstop',
    description:
      'The exact formula behind a tabstop score: impact weights, the per-rule element cap, a worked example, and what the score does not measure.',
    entry: 'src/screens/modules/docs/pages/ScoreFormula/index.tsx',
  },
];

export const PRERENDER_PATHS: readonly string[] = PRERENDER_PAGES.map(({path}) => path);

export const outputFor = (dist: string, path: string): string =>
  path === '/' ? join(dist, 'index.html') : join(dist, path, 'index.html');

export const servesAppShell = (pathname: string): boolean => {
  const path = pathname.split('?')[0]!.replace(/\/+$/, '');
  return !PRERENDER_PATHS.includes(path === '' ? '/' : path);
};
