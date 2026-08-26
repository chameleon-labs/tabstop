import {Outlet, useMatches} from 'react-router';
import {RouteAnnouncer} from '../RouteAnnouncer';
import {RouteProgress} from '../RouteProgress';
import {SiteHeader, type HeaderSection} from '../SiteHeader';
import {useLogout} from '@/screens/modules/account/mutations';
import {useRouteBusy} from '@/screens/hooks/use-route-busy';

export type RouteChrome = {
  /**
   * The route renders its own `<main>` and any footer after it. Not the
   * header. A `<footer>` inside `<main>` is not a `contentinfo` landmark.
   */
  ownMain?: boolean;
  sessionFree?: boolean;
  sections?: readonly HeaderSection[];
};

/**
 * Narrowed rather than cast: `handle` is `unknown` by construction, since any
 * route may put anything there, and asserting a shape onto it would compile
 * just as happily against a typo in the route table.
 */
const isHandle = (handle: unknown): handle is Record<string, unknown> =>
  typeof handle === 'object' && handle !== null && !Array.isArray(handle);

export const providesOwnMain = (handle: unknown): boolean =>
  isHandle(handle) && 'ownMain' in handle && handle['ownMain'] === true;

export const providesSessionFree = (handle: unknown): boolean =>
  isHandle(handle) && 'sessionFree' in handle && handle['sessionFree'] === true;

/** Read from the handle: a screen cannot pass children up to the layout. */
export const sectionsFrom = (handle: unknown): readonly HeaderSection[] | undefined => {
  if (!isHandle(handle) || !Array.isArray(handle['sections'])) {
    return undefined;
  }

  const sections = handle['sections'].filter(
    (item): item is HeaderSection =>
      isHandle(item) && typeof item['id'] === 'string' && typeof item['label'] === 'string',
  );

  return sections.length === 0 ? undefined : sections;
};

/** True when the matched route says it renders its own `<main>` and footer. */
export const useOwnMain = (): boolean => useMatches().some((match) => providesOwnMain(match.handle));

export const useSessionFree = (): boolean => useMatches().some((match) => providesSessionFree(match.handle));

export const useHeaderSections = (): readonly HeaderSection[] | undefined =>
  useMatches().reduce<readonly HeaderSection[] | undefined>(
    (found, match) => sectionsFrom(match.handle) ?? found,
    undefined,
  );

/**
 * The shell every route renders into. `<main>` carries `tabIndex={-1}` or the
 * skip link moves scroll without focus.
 *
 * The full-height column lives here, not on `.landing-page`: that wrapper no
 * longer contains the header, so a `100vh` there would stack beneath it.
 */
export type LayoutProps = {
  children?: React.ReactNode;
};

export const Layout = ({children}: LayoutProps = {}): React.JSX.Element => {
  const ownMain = useOwnMain();
  const sessionFree = useSessionFree();
  const sections = useHeaderSections();
  const logout = useLogout();
  const busy = useRouteBusy();
  const hidePrivateOutlet = logout.isRevoked && !ownMain && !sessionFree;
  const content = children ?? (hidePrivateOutlet ? null : <Outlet />);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <RouteAnnouncer />
      <SiteHeader sections={sections} sessionFree={sessionFree} logout={logout} />
      <RouteProgress busy={busy} />
      {ownMain ? (
        content
      ) : (
        <main id="main" tabIndex={-1} className="app-shell__main" aria-busy={busy || undefined}>
          {content}
        </main>
      )}
    </div>
  );
};
