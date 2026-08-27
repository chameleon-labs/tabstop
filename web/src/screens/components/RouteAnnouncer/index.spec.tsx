import {act, render, screen, waitFor} from '@testing-library/react';
import {useEffect, useState} from 'react';
import {Outlet, RouterProvider, createMemoryRouter} from 'react-router';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {renderAt} from '@/test/render';
import {jsonResponse} from '@/test/http';
import {RouteAnnouncer} from './index';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import type {PageHistoryResponse, PageSummary} from '@tabstop/contract';

const monitoredPage = (id: string): PageSummary => ({
  id,
  url: `https://example.com/${id}`,
  monitoringEnabled: true,
  createdAt: '2026-08-01T10:00:00.000Z',
  domain: 'example.com',
  latestAudit: null,
  score: null,
  previousScore: null,
  history: [],
  nextAuditAt: null,
});

const pageHistory = (id: string): PageHistoryResponse => ({
  pageId: id,
  url: `https://example.com/${id}`,
  days: 90,
  points: [],
});

const sameSitePages = (path: string): Promise<Response> => {
  const history = /^\/api\/pages\/(\d+)\/history/.exec(path);
  if (history !== null) {
    return Promise.resolve(jsonResponse(200, pageHistory(history[1]!)));
  }
  if (path === '/api/pages') {
    return Promise.resolve(jsonResponse(200, {pages: [monitoredPage('1'), monitoredPage('2')], used: 2, limit: 10}));
  }

  return Promise.resolve(jsonResponse(200, {id: '1', email: 'a@b.co', alertThreshold: 5}));
};

describe('the route announcer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const liveRegion = (): HTMLElement => screen.getAllByRole('status')[0] as HTMLElement;

  it('stays quiet on first load, which the browser has already announced', async () => {
    renderAt('/');

    await screen.findByRole('heading', {level: 1});
    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });

    expect(liveRegion()).toHaveTextContent('');
  });

  it('names the new page after a navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'}))),
    );
    renderAt('/nope');
    await screen.findByRole('heading', {level: 1, name: 'Page not found'});

    await userEvent.click(screen.getByRole('link', {name: 'Back to the start'}));

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('tabstop');
    });
    expect(liveRegion()).not.toHaveTextContent('Page not found');
  });

  it('announces once when the destination names itself late', async () => {
    const Named = (): null => {
      useDocumentTitle('Late page');
      return null;
    };
    const SlowScreen = (): React.JSX.Element => {
      const [ready, setReady] = useState(false);
      useEffect(() => {
        const timer = setTimeout(() => {
          setReady(true);
        }, 300);
        return () => {
          clearTimeout(timer);
        };
      }, []);
      return (
        <>
          {ready && <Named />}
          <h1>Late page</h1>
        </>
      );
    };

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <>
              <RouteAnnouncer />
              <Outlet />
            </>
          ),
          children: [
            {index: true, element: <h1>Start</h1>},
            {path: 'late', element: <SlowScreen />},
          ],
        },
      ],
      {initialEntries: ['/']},
    );
    render(<RouterProvider router={router} />);

    const region = screen.getByRole('status');
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      seen.push(region.textContent ?? '');
    });
    observer.observe(region, {childList: true, characterData: true, subtree: true});

    await act(async () => {
      await router.navigate('/late');
    });
    await waitFor(() => {
      expect(region).toHaveTextContent('Late page');
    });
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });
    });
    observer.disconnect();

    expect(seen.filter((text) => text !== '')).toEqual(['Late page · tabstop']);
  });

  it('announces again when two paths share a title', async () => {
    vi.stubGlobal('fetch', vi.fn(sameSitePages));

    try {
      const {router} = renderAt('/');
      await act(async () => {
        await router.navigate('/pages/1');
      });
      await waitFor(() => {
        expect(liveRegion()).toHaveTextContent('example.com');
      });

      const seen: string[] = [];
      const observer = new MutationObserver(() => {
        seen.push(liveRegion().textContent ?? '');
      });
      observer.observe(liveRegion(), {childList: true, characterData: true, subtree: true});

      await act(async () => {
        await router.navigate('/pages/2');
      });
      await waitFor(() => {
        expect(liveRegion()).toHaveTextContent('example.com');
      });
      observer.disconnect();

      expect(seen).toContain('');
      expect(seen.at(-1)).toContain('example.com');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the region mounted and empty while there is nothing to say', () => {
    renderAt('/');

    expect(liveRegion()).toBeInTheDocument();
    expect(liveRegion()).toBeEmptyDOMElement();
  });
});
