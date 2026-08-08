import {createRoot, hydrateRoot, type Root} from 'react-dom/client';

/**
 * `prerender.ts` writes `dist/<path>/index.html`, which hosts serve at both
 * `/<path>` and `/<path>/` - the same file, two URLs. The stamp compares
 * exactly, so without this the trailing-slash form would silently miss and
 * fall back to a client render instead of hydrating.
 */
const withoutTrailingSlash = (path: string): string => (path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path);

/**
 * Mounts the app, hydrating only markup that was prerendered for THIS path.
 *
 * Unconditional `hydrateRoot` is correct only while the host serves each
 * prerendered file for the path it was rendered for, and the failure is silent:
 * `/dashboard` handed landing-page HTML does not error, it mismatches and
 * re-renders. That looks identical to working locally and degrades in
 * production, so correctness is kept here rather than in deployment config,
 * which then becomes an optimisation.
 *
 * The stamp compares PATHS, not builds. Markup that is stale for the same path
 * - a cached `index.html`, a prerender run against a different bundle - carries
 * the right stamp and is hydrated; React's own mismatch recovery handles those,
 * at the cost of a discarded paint.
 */
export const mountApp = (container: HTMLElement, tree: React.ReactNode, pathname: string): Root => {
  const stamp = container.dataset.prerendered;
  if (stamp !== undefined && withoutTrailingSlash(stamp) === withoutTrailingSlash(pathname)) {
    return hydrateRoot(container, tree);
  }

  container.innerHTML = '';
  const root = createRoot(container);
  root.render(tree);

  return root;
};
