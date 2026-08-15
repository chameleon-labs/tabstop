import {escapeHtml} from './inject';
import type {PrerenderedPage} from './paths';

/**
 * Fails the build when the write `main()` depends on did not actually happen.
 *
 * `_redirects` sends every non-prerendered path to `/app.html` (see the
 * comment there), so a build that silently stopped writing it would leave
 * every route but `/` 404ing on the host - while `pnpm build` still exited 0,
 * since neither `vite build` nor a plain `writeFile` call fails for that. This
 * is the one check standing between that and CI staying green. Every
 * prerendered output is checked independently: a valid landing page cannot
 * stand in for a missing or wrongly stamped nested page.
 *
 * The whole FILE is checked, not the rendered body alone. A page that shipped
 * the landing page's title, or none of its stylesheets, renders correctly in
 * every test that mounts the component and is still wrong for every crawler
 * and every first paint.
 */
export type PrerenderedOutput = {
  page: PrerenderedPage;
  exists: boolean;
  html: string;
  stylesheets: readonly string[];
};

const outputName = (path: string): string => (path === '/' ? 'dist/index.html' : `dist${path}/index.html`);

export const assertBuildOutput = (
  appHtmlExists: boolean,
  indexHtml: string,
  prerenderedOutputs: readonly PrerenderedOutput[] = [],
): void => {
  if (!appHtmlExists) {
    throw new Error('dist/app.html was not written; every route but / would 404 on the host');
  }

  if (!indexHtml.includes('data-prerendered')) {
    throw new Error('dist/index.html has no data-prerendered stamp; the landing page was not prerendered');
  }

  for (const {page, exists, html, stylesheets} of prerenderedOutputs) {
    const {path, title, description, entry} = page;
    const output = outputName(path);

    if (!exists) {
      throw new Error(`${output} was not written; ${path} was not prerendered`);
    }

    const stamp = `data-prerendered="${path}"`;
    if (!html.includes(stamp)) {
      throw new Error(`${output} has no ${stamp} stamp`);
    }

    if (title !== undefined && !html.includes(`<title>${escapeHtml(title)}</title>`)) {
      throw new Error(`${output} does not carry its own title "${title}"`);
    }

    if (description !== undefined && !html.includes(`content="${escapeHtml(description)}"`)) {
      throw new Error(`${output} does not carry its own description meta`);
    }

    if (entry !== undefined && stylesheets.length === 0) {
      throw new Error(`${entry} resolved to no stylesheets; ${output} would paint unstyled until its chunk loads`);
    }

    for (const href of stylesheets) {
      if (!html.includes(`href="${href}"`)) {
        throw new Error(`${output} does not link ${href}`);
      }
    }
  }
};
