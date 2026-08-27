import {createRoot, hydrateRoot, type Root} from 'react-dom/client';

const withoutTrailingSlash = (path: string): string => (path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path);

export const isPrerenderedForPath = (container: HTMLElement, pathname: string): boolean => {
  const stamp = container.dataset.prerendered;
  return stamp !== undefined && withoutTrailingSlash(stamp) === withoutTrailingSlash(pathname);
};

type InitialRouter = {
  state: {initialized: boolean};
  subscribe: (listener: (state: {initialized: boolean}) => void) => () => void;
};

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

  if (mounted) {
    subscription.unsubscribe();
  } else if (router.state.initialized) {
    mountOnce();
  }
};

export const mountApp = (container: HTMLElement, tree: React.ReactNode, pathname: string): Root => {
  if (isPrerenderedForPath(container, pathname)) {
    return hydrateRoot(container, tree);
  }

  container.innerHTML = '';
  const root = createRoot(container);
  root.render(tree);

  return root;
};
