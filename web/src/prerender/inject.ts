import type {PrerenderedPage} from './paths';

/** What Vite's template leaves for React to fill. */
const ROOT = '<div id="root"></div>';
const TITLE = /<title>[\s\S]*?<\/title>/;
const DESCRIPTION = /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/;
const HEAD_END = '</head>';

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Puts prerendered markup into the built `index.html`, recording which path it
 * was rendered for.
 *
 * The stamp is what lets the client tell prerendered markup for THIS page from
 * markup for a different one - see `hydrate.ts`.
 *
 * The head is rewritten in the same pass, because the template's is the landing
 * page's - see `PrerenderedPage`. Each replacement throws rather than no-ops
 * when its anchor is gone: a page that quietly kept the landing page's title,
 * or lost its stylesheets, still renders, and no behavioural test can see it.
 */
export const injectMarkup = (
  template: string,
  page: PrerenderedPage,
  html: string,
  stylesheets: readonly string[] = [],
): string => {
  if (!template.includes(ROOT)) {
    throw new Error(`the built index.html no longer contains ${ROOT}; nothing was prerendered`);
  }

  const {path, title, description} = page;
  let output = template;

  if (title !== undefined) {
    if (!TITLE.test(output)) {
      throw new Error(`the built index.html has no <title> to replace, so ${path} would publish no title of its own`);
    }
    output = output.replace(TITLE, () => `<title>${escapeHtml(title)}</title>`);
  }

  if (description !== undefined) {
    if (!DESCRIPTION.test(output)) {
      throw new Error(`the built index.html has no description meta to replace for ${path}`);
    }
    output = output.replace(DESCRIPTION, () => `<meta name="description" content="${escapeHtml(description)}" />`);
  }

  const missing = stylesheets.filter((href) => !output.includes(`href="${href}"`));
  if (missing.length > 0) {
    if (!output.includes(HEAD_END)) {
      throw new Error(`the built index.html has no ${HEAD_END}; ${path} cannot link its route stylesheets`);
    }
    const links = missing.map((href) => `<link rel="stylesheet" crossorigin href="${href}">`).join('');
    output = output.replace(HEAD_END, () => `${links}${HEAD_END}`);
  }

  return output.replace(ROOT, () => `<div id="root" data-prerendered="${path}">${html}</div>`);
};
