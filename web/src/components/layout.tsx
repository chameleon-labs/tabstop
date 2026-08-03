import { Link, Outlet } from 'react-router'
import { RouteAnnouncer } from './route-announcer'

/**
 * The shell every route renders into.
 *
 * The skip link is first in the DOM and only visible on focus, which is the
 * whole mechanism: a keyboard user should not tab through the header on every
 * page to reach the content. It targets `#main`, which is why `<main>` carries
 * `tabIndex={-1}` - without it the browser moves the scroll position but not
 * focus, and the next Tab starts from the top of the page again.
 */
export const Layout = (): React.JSX.Element => (
  <>
    <a className="skip-link" href="#main">Skip to content</a>
    <RouteAnnouncer />

    <header className="site-header">
      <Link to="/" className="wordmark">tabstop</Link>
      <nav aria-label="Main">
        <Link to="/dashboard">Dashboard</Link>
      </nav>
    </header>

    <main id="main" tabIndex={-1}>
      <Outlet />
    </main>
  </>
)
