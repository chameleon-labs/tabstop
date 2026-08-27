import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {jsonResponse} from '@/test/http';
import {useLogout} from '@/screens/modules/account/mutations';
import {SiteHeader, type HeaderSection} from './index';

const SECTIONS: readonly HeaderSection[] = [
  {id: 'how', label: 'How it works'},
  {id: 'why', label: 'Why tabstop'},
];

const Harness = ({sections, sessionFree}: {sections?: readonly HeaderSection[]; sessionFree?: boolean}) => {
  const logout = useLogout();

  return <SiteHeader sections={sections} sessionFree={sessionFree ?? false} logout={logout} />;
};

const renderHeader = (props: {sections?: readonly HeaderSection[]; sessionFree?: boolean} = {}): void => {
  render(
    <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
      <RouterProvider
        router={createMemoryRouter([{path: '*', element: <Harness {...props} />}], {initialEntries: ['/anywhere']})}
      />
    </QueryClientProvider>,
  );
};

describe('SiteHeader', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(jsonResponse(401, {error: 'Unauthorized'})));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is the page banner, with a way home', () => {
    renderHeader();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'tabstop'})).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', {name: 'tabstop'})).toHaveAttribute('aria-label', 'tabstop');
  });

  it('renders no section nav when a route declares none', () => {
    renderHeader();

    expect(screen.queryByRole('navigation', {name: 'Page sections'})).not.toBeInTheDocument();
  });

  it('renders the sections a route declares, as in-page anchors', () => {
    renderHeader({sections: SECTIONS});

    const nav = screen.getByRole('navigation', {name: 'Page sections'});
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'How it works'})).toHaveAttribute('href', '#how');
    expect(screen.getByRole('link', {name: 'Why tabstop'})).toHaveAttribute('href', '#why');
  });

  it('treats an empty section list as none, rather than an empty landmark', () => {
    renderHeader({sections: []});

    expect(screen.queryByRole('navigation', {name: 'Page sections'})).not.toBeInTheDocument();
  });

  it('knows nothing about what any section means', () => {
    renderHeader({sections: [{id: 'anything', label: 'Anything at all'}]});

    expect(screen.getByRole('link', {name: 'Anything at all'})).toHaveAttribute('href', '#anything');
  });

  it('asks who is signed in on an ordinary route', async () => {
    renderHeader();

    expect(await screen.findByRole('link', {name: 'Log in'})).toBeVisible();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/me']);
  });

  it('costs a session-free route nothing at all', async () => {
    renderHeader({sessionFree: true});

    expect(await screen.findByRole('link', {name: 'Log in'})).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
