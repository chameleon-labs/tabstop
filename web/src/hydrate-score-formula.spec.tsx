import {act, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {StrictMode} from 'react';
import {createBrowserRouter} from 'react-router';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {App} from './app';
import {makeQueryClient} from './api/query-client';
import {render as prerender} from './entry-server';
import {isPrerenderedForPath, mountApp, mountWhenRouterReady} from './hydrate';
import {makeRoutes} from './routes';

describe('the prerendered score formula', () => {
  const originalUrl = window.location.href;

  afterEach(() => {
    window.history.replaceState(null, '', originalUrl);
    document.body.innerHTML = '';
  });

  it('hydrates the matching docs markup without replacing it and keeps its links interactive', async () => {
    const container = document.createElement('div');
    container.dataset.prerendered = '/docs/score-formula';
    container.innerHTML = await prerender('/docs/score-formula');
    document.body.append(container);
    window.history.replaceState(null, '', '/docs/score-formula');

    const originalHeading = screen.getByRole('heading', {level: 1, name: 'How the score is calculated'});
    const queryClient = makeQueryClient();
    const router = createBrowserRouter(makeRoutes(queryClient));
    let root: ReturnType<typeof mountApp> | undefined;

    try {
      await act(async () => {
        await new Promise<void>((resolve) => {
          mountWhenRouterReady(isPrerenderedForPath(container, window.location.pathname), router, () => {
            root = mountApp(
              container,
              <StrictMode>
                <App queryClient={queryClient} router={router} />
              </StrictMode>,
              window.location.pathname,
            );
            resolve();
          });
        });
      });

      expect(screen.getByRole('heading', {level: 1, name: 'How the score is calculated'})).toBe(originalHeading);

      await userEvent.click(screen.getByRole('link', {name: '← tabstop'}));
      expect(await screen.findByRole('heading', {level: 1, name: /Accessibility monitoring/})).toBeVisible();
    } finally {
      act(() => {
        root?.unmount();
      });
      router.dispose();
    }
  });

  it('restores a direct section hash after the lazy route hydrates', async () => {
    const container = document.createElement('div');
    container.dataset.prerendered = '/docs/score-formula';
    container.innerHTML = await prerender('/docs/score-formula');
    document.body.append(container);
    window.history.replaceState(null, '', '/docs/score-formula#limitations');

    const limitations = container.querySelector<HTMLElement>('#limitations')!;
    const scrollIntoView = vi.fn();
    limitations.scrollIntoView = scrollIntoView;

    const queryClient = makeQueryClient();
    const router = createBrowserRouter(makeRoutes(queryClient));
    let root: ReturnType<typeof mountApp> | undefined;

    try {
      await act(async () => {
        await new Promise<void>((resolve) => {
          mountWhenRouterReady(isPrerenderedForPath(container, window.location.pathname), router, () => {
            root = mountApp(
              container,
              <StrictMode>
                <App queryClient={queryClient} router={router} />
              </StrictMode>,
              window.location.pathname,
            );
            resolve();
          });
        });
      });

      expect(scrollIntoView).toHaveBeenCalled();
    } finally {
      act(() => {
        root?.unmount();
      });
      router.dispose();
    }
  });
});
