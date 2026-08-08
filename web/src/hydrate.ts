import {createRoot, hydrateRoot, type Root} from 'react-dom/client';

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
  if (container.dataset.prerendered === pathname) {
    return hydrateRoot(container, tree);
  }

  container.innerHTML = '';
  const root = createRoot(container);
  root.render(tree);

  return root;
};
