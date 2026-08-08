/** What Vite's template leaves for React to fill. */
const ROOT = '<div id="root"></div>';

/**
 * Puts prerendered markup into the built `index.html`, recording which path it
 * was rendered for.
 *
 * The stamp is what lets the client tell prerendered markup for THIS page from
 * markup for a different one - see `hydrate.ts`.
 */
export const injectMarkup = (template: string, path: string, html: string): string => {
  if (!template.includes(ROOT)) {
    throw new Error(`the built index.html no longer contains ${ROOT}; nothing was prerendered`);
  }

  return template.replace(ROOT, () => `<div id="root" data-prerendered="${path}">${html}</div>`);
};
