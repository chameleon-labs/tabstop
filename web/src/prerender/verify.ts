import {escapeHtml} from './inject';
import type {PrerenderedPage} from './paths';

export type PrerenderedOutput = {
  page: PrerenderedPage;
  exists: boolean;
  html: string;
  stylesheets: readonly string[];
};

const outputName = (path: string): string => (path === '/' ? 'dist/index.html' : `dist${path}/index.html`);

export const assertBuildOutput = (
  appHtml: string,
  indexHtml: string,
  prerenderedOutputs: readonly PrerenderedOutput[] = [],
): void => {
  if (appHtml === '') {
    throw new Error('dist/app.html was not written; every route but / would 404 on the host');
  }

  if (!appHtml.includes('class="route-skeleton"')) {
    throw new Error(
      'dist/app.html carries no skeleton; every guarded route would paint white until its bundle arrives',
    );
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
