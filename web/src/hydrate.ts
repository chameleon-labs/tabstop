import {createRoot, hydrateRoot, type Root} from 'react-dom/client';

/**
 * `prerender.ts` writes `dist/<path>/index.html`, which hosts serve at both
 * `/<path>` and `/<path>/` - the same file, two URLs. The stamp compares
 * exactly, so without this the trailing-slash form would silently miss and
 * fall back to a client render instead of hydrating.
 */
const withoutTrailingSlash = (path: string): string => (path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path);

export const isPrerenderedForPath = (container: HTMLElement, pathname: string): boolean => {
  const stamp = container.dataset.prerendered;
  return stamp !== undefined && withoutTrailingSlash(stamp) === withoutTrailingSlash(pathname);
};

type InitialRouter = {
  state: {initialized: boolean};
  subscribe: (listener: (state: {initialized: boolean}) => void) => () => void;
};

/**
 * A lazy route cannot hydrate until its browser router has imported the route
 * module. Wait only when the server markup belongs to this path: an app-shell
 * response needs its fallback rendered immediately, even while its route loads.
 */
export const mountWhenRouterReady = (matchingPrerender: boolean, router: InitialRouter, mount: () => void): void => {
  if (!matchingPrerender || router.state.initialized) {
    mount();
    return;
  }

  let mounted = false;
  const subscription: {unsubscribe: (() => void) | undefined} = {unsubscribe: undefined};
  const mountOnce = (): void => {
    if (mounted) {
      return;
    }
    mounted = true;
    subscription.unsubscribe?.();
    mount();
  };

  subscription.unsubscribe = router.subscribe((state) => {
    if (state.initialized) {
      mountOnce();
    }
  });

  // `initialized` can change after the first check but before subscribe()
  // returns. Re-checking closes that gap; the once guard also handles a
  // synchronous subscription callback.
  if (mounted) {
    subscription.unsubscribe();
  } else if (router.state.initialized) {
    mountOnce();
  }
};

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
  if (isPrerenderedForPath(container, pathname)) {
    return hydrateRoot(container, tree);
  }

  container.innerHTML = '';
  const root = createRoot(container);
  root.render(tree);

  return root;
};
