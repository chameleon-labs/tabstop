import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {THEME_STORAGE_KEY} from '@/theme/theme';
import {jsonResponse} from '@/test/http';
import {AccountMenu} from './index';
import {useLogout} from '../../mutations';

const account = {id: '7', email: 'ada.lovelace@example.test', alertThreshold: 5};

const Harness = (): React.JSX.Element => {
  const logout = useLogout();

  return <AccountMenu email={account.email} logout={logout} />;
};

const renderMenu = (): ReturnType<typeof createMemoryRouter> => {
  const router = createMemoryRouter([{path: '*', element: <Harness />}], {initialEntries: ['/dashboard']});

  render(
    <QueryClientProvider
      client={new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}})}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return router;
};

/** Reads the rendered icon, not a `data-testid` put there for the test. */
const checkIn = (name: string): Element | null =>
  screen.getByRole('menuitemradio', {name}).querySelector('.account-menu__check svg');

const open = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', {name: /Account menu/}));
  await screen.findByRole('menu');
};

describe('AccountMenu', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(new Response(null, {status: 204})));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    document.documentElement.removeAttribute('data-lat-theme');
    document.documentElement.style.removeProperty('color-scheme');
  });

  it('names its trigger for the account, so two windows are tellable apart', () => {
    renderMenu();

    expect(screen.getByRole('button', {name: `Account menu for ${account.email}`})).toBeVisible();
  });

  it('draws two initials from the address, not the one Lattice reads from a single word', () => {
    // `ada.lovelace@` is one word to a whitespace splitter, which renders `A`
    // for every address a person is likely to have.
    renderMenu();

    expect(screen.getByRole('button', {name: /Account menu/})).toHaveTextContent('AL');
  });

  it('keeps its contents closed until asked', () => {
    renderMenu();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', {name: 'Log out'})).not.toBeInTheDocument();
  });

  it('shows the signed-in address inside, without putting it in the a11y tree twice', async () => {
    // Visible, but the trigger already announces it - and a menu may not
    // own a bare paragraph.
    renderMenu();

    await open();

    const email = screen.getByText(account.email);
    expect(email).toBeVisible();
    expect(email).toHaveAttribute('aria-hidden', 'true');
  });

  it('owns only what a menu is allowed to own', async () => {
    // A `<p>` slipped in here and rendered perfectly. This class of bug is
    // invisible to every other assertion in the file.
    const PERMITTED = new Set(['menuitem', 'menuitemradio', 'menuitemcheckbox', 'group', 'separator']);
    renderMenu();

    await open();

    const offenders = [...screen.getByRole('menu').children]
      .filter((child) => child.getAttribute('aria-hidden') !== 'true')
      // `<hr>` carries `separator` implicitly, so a missing role attribute is
      // correct there rather than an omission.
      .filter((child) => child.tagName !== 'HR')
      .filter((child) => !PERMITTED.has(child.getAttribute('role') ?? ''))
      .map((child) => `${child.tagName.toLowerCase()}[role=${child.getAttribute('role') ?? 'none'}]`);

    expect(offenders).toEqual([]);
  });

  describe('the theme control', () => {
    it('offers all three choices as a labelled radio group', async () => {
      // Three, not two: "match system" is a real state, and needs a menu.
      renderMenu();

      await open();

      expect(screen.getByRole('group', {name: 'Theme'})).toBeInTheDocument();
      expect(screen.getAllByRole('menuitemradio')).toHaveLength(3);
      for (const name of ['Match system', 'Light', 'Dark']) {
        expect(screen.getByRole('menuitemradio', {name})).toBeInTheDocument();
      }
    });

    it('starts with the stored choice checked, and only that one', async () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      renderMenu();

      await open();

      expect(screen.getByRole('menuitemradio', {name: 'Dark'})).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('menuitemradio', {name: 'Light'})).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('menuitemradio', {name: 'Match system'})).toHaveAttribute('aria-checked', 'false');
    });

    it('checks match-system when nothing is stored', async () => {
      renderMenu();

      await open();

      expect(screen.getByRole('menuitemradio', {name: 'Match system'})).toHaveAttribute('aria-checked', 'true');
    });

    it('marks the selected choice with something a person can see', async () => {
      // `aria-checked` says nothing to a sighted reader, and a highlight is
      // taken: `[data-active-item]` uses one for the keyboard position.
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      renderMenu();

      await open();

      expect(checkIn('Dark')).not.toBeNull();
      expect(checkIn('Light')).toBeNull();
      expect(checkIn('Match system')).toBeNull();
    });

    it('puts the mark after the label, so every item in the menu starts at the same edge', async () => {
      // A leading slot would indent these three past "Log out", which has
      // none. Structure, not pixels: jsdom computes no layout.
      renderMenu();
      await open();

      for (const item of screen.getAllByRole('menuitemradio')) {
        const slot = item.querySelector('.account-menu__check');

        expect(slot).not.toBeNull();
        // `lastChild`: the label is a text node, so the element-only
        // version passes against a leading slot too. It did.
        expect(item.lastChild).toBe(slot);
      }
    });

    it('reserves room for the mark on every choice, whether or not it holds one', async () => {
      // So the trailing edge does not jump as the choice moves.
      renderMenu();
      await open();

      const slots = screen.getAllByRole('menuitemradio').map((item) => item.querySelector('.account-menu__check'));

      expect(slots).toHaveLength(3);
      expect(slots.every((slot) => slot !== null)).toBe(true);
    });

    it('moves the mark when the choice moves', async () => {
      renderMenu();
      await open();

      await userEvent.click(screen.getByRole('menuitemradio', {name: 'Light'}));

      expect(checkIn('Light')).not.toBeNull();
      expect(checkIn('Match system')).toBeNull();
    });

    it('applies and persists a choice', async () => {
      renderMenu();
      await open();

      await userEvent.click(screen.getByRole('menuitemradio', {name: 'Light'}));

      expect(document.documentElement).toHaveAttribute('data-lat-theme', 'light');
      expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    });

    it('stays open while the theme is changed, so the result is visible behind it', async () => {
      // Closing would hide the page the choice just repainted.
      renderMenu();
      await open();

      await userEvent.click(screen.getByRole('menuitemradio', {name: 'Dark'}));

      expect(screen.getByRole('menu')).toBeVisible();
      expect(screen.getByRole('menuitemradio', {name: 'Dark'})).toHaveAttribute('aria-checked', 'true');
    });

    it('hands the choice back to the system, unstamping the document', async () => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      renderMenu();
      await open();

      await userEvent.click(screen.getByRole('menuitemradio', {name: 'Match system'}));

      expect(document.documentElement.hasAttribute('data-lat-theme')).toBe(false);
      expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });
  });

  describe('logging out', () => {
    it('revokes the session and leaves', async () => {
      fetchMock.mockImplementation((path: string) =>
        Promise.resolve(path === '/api/logout' ? new Response(null, {status: 204}) : jsonResponse(401, {error: 'no'})),
      );
      const router = renderMenu();
      await open();

      await userEvent.click(screen.getByRole('menuitem', {name: 'Log out'}));

      await vi.waitFor(() => {
        expect(router.state.location.pathname).toBe('/');
      });
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/logout');
    });

    it('stays where it is and explains when the revoke fails', async () => {
      // Leaving would put a live session behind a page saying otherwise.
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Could not revoke this session'})));
      const router = renderMenu();
      await open();

      await userEvent.click(screen.getByRole('menuitem', {name: 'Log out'}));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Could not revoke this session');
      expect(alert).toHaveFocus();
      expect(router.state.location.pathname).toBe('/dashboard');
    });

    it('leaves the item usable after a failure, rather than stuck disabled', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(500, {error: 'Could not revoke this session'})));
      renderMenu();
      await open();

      await userEvent.click(screen.getByRole('menuitem', {name: 'Log out'}));
      await screen.findByRole('alert');

      // The menu stays open behind the callout, so retrying is one click.
      expect(screen.getByRole('menu')).toBeVisible();
      const item = screen.getByRole('menuitem', {name: 'Log out'});
      expect(item).not.toHaveAttribute('aria-disabled', 'true');
      expect(item).toHaveTextContent('Log out');
    });
  });
});
