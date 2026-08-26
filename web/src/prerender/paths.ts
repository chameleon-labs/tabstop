import {join} from 'node:path';

/**
 * A route rendered at build time, and everything its artifact needs that the
 * rendered body cannot supply.
 *
 * Every artifact is stamped out of the same `dist/index.html`, whose head is
 * the landing page's. A page that declares no `title` publishes the landing
 * page's title under its own URL, and `useDocumentTitle` cannot repair it -
 * that runs after hydration, which crawlers and no-JavaScript visits never
 * reach. `entry` is the same problem for CSS: Vite attaches a lazy route's
 * stylesheets to its chunk, so nothing in the template links them.
 */
export type PrerenderedPage = {
  readonly path: string;
  /** The complete `<title>`, suffix included. */
  readonly title?: string;
  readonly description?: string;
  /** The route's manifest key: the chunk whose stylesheets to link. */
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

/**
 * Whether the host answers this path with `app.html` rather than a prerendered
 * file. Mirrors `_redirects`, and is what lets the dev and preview servers
 * behave the way the host does.
 */
export const servesAppShell = (pathname: string): boolean => {
  const path = pathname.split('?')[0]!.replace(/\/+$/, '');
  return !PRERENDER_PATHS.includes(path === '' ? '/' : path);
};
