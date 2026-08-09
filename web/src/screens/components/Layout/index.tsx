import {Link, Outlet, useMatches} from 'react-router';
import {RouteAnnouncer} from '../RouteAnnouncer';
import {AccountNavigation} from '@/screens/modules/account/components/AccountNavigation';

/** A route declaring that it renders its own header, main and footer. */
export type RouteChrome = {ownChrome?: boolean};

/**
 * Narrowed rather than cast: `handle` is `unknown` by construction, since any
 * route may put anything there, and asserting a shape onto it would compile
 * just as happily against a typo in the route table.
 */
export const providesOwnChrome = (handle: unknown): boolean =>
  typeof handle === 'object' && handle !== null && 'ownChrome' in handle && handle.ownChrome === true;

/**
 * The shell every route renders into.
 *
 * The skip link is first in the DOM and only visible on focus, which is the
 * whole mechanism: a keyboard user should not tab through the header on every
 * page to reach the content. It targets `#main`, which is why `<main>` carries
 * `tabIndex={-1}` - without it the browser moves the scroll position but not
 * focus, and the next Tab starts from the top of the page again.
 *
 * ONE route supplies its own chrome: the landing page, whose design carries a
 * nav and a footer of its own. Nesting that inside this shell produced two
 * `banner` landmarks, two "tabstop" wordmarks and a `<main>` inside a `<main>`
 * - invalid, and it breaks the skip link by giving `#main` two candidates.
 *
 * So the shell steps back to the skip link and the announcer, and that screen
 * owns the three landmarks. What stays true either way is the invariant the
 * specs pin: exactly one banner, one main and one contentinfo, and a `#main`
 * for the skip link to land on. Declared in the route table rather than matched
 * on a path here, so the exception is visible where routes are read.
 */
/** True when the matched route says it renders its own header, main and footer. */
export const useOwnChrome = (): boolean => useMatches().some((match) => providesOwnChrome(match.handle));

export const Layout = (): React.JSX.Element => {
  const ownChrome = useOwnChrome();

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <RouteAnnouncer />

      {ownChrome ? (
        <Outlet />
      ) : (
        <>
          <header className="site-header">
            <Link to="/" className="wordmark">
              tabstop
            </Link>
            <AccountNavigation />
          </header>

          <main id="main" tabIndex={-1}>
            <Outlet />
          </main>
        </>
      )}
    </>
  );
};
