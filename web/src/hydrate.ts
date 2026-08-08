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
 * The same branch covers a stale `index.html` served from a cache after a
 * deploy, and a `dist-ssr/` that drifted from `dist/`.
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
