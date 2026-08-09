import type {RouteObject} from 'react-router';
import {Layout} from './screens/components/Layout';
import {NotFound} from './screens/components/NotFound';
import {RequireAuth} from './screens/modules/account/components/RequireAuth';
import {RequireAnonymous} from './screens/modules/account/components/RequireAnonymous';
import {RouteError} from './screens/components/RouteError';
import {Home} from './screens/modules/audit/pages/Home';

/**
 * Exported as data rather than JSX so a spec can mount it with
 * `createMemoryRouter` and assert what each path resolves to - the routing is
 * then tested as the app's own configuration, not as a copy of it written in
 * the test.
 *
 * THE PATHLESS ROUTE IS LOAD-BEARING. An `errorElement` renders in place of the
 * route that declares it, so putting one on the layout route replaces the
 * layout - header, skip link and all - and the reader loses every way out of
 * the error. Declared one level down, on a route with no path of its own, it
 * renders into the layout's `<Outlet />` instead, which is what actually keeps
 * the shell. A spec asserts the skip link survives a failed screen; it did not,
 * the first time this was written.
 *
 * The root route keeps one as a last resort, for the case the pathless boundary
 * cannot cover: `Layout` itself throwing.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    // Rendered while a lazy route's chunk is in flight on a DIRECT visit.
    // `<Layout />`, not empty: a fallback declared on the ROOT route replaces
    // what that route renders, not just the page inside it - `RequireAuth`'s
    // "beat of nothing" is a different case, because it renders INSIDE an
    // already-painted shell. Empty here instead means no skip link, no header,
    // no route announcer for the whole window before the chunk resolves, on
    // every lazy route - the exact failure prerendering exists to remove.
    //
    // `Layout` degrades correctly in this position: `useMatches()` is still
    // populated from the router's matched-but-unloaded routes. No lazy route
    // supplies its own chrome, so the header and empty main remain available
    // until the child chunk resolves.
    hydrateFallbackElement: <Layout />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          // Declares that Home renders its own header, main and footer: its
          // design carries a nav and footer, and nesting those inside the
          // shell's would produce two banners and a nested <main>. See Layout.
          {index: true, element: <Home />, handle: {ownChrome: true}},
          {
            path: 'dashboard',
            lazy: async () => {
              const {Dashboard} = await import('./screens/modules/audit/pages/Dashboard');
              return {
                element: (
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                ),
              };
            },
          },
          {
            path: 'login',
            lazy: async () => {
              const {Login} = await import('./screens/modules/account/pages/Login');
              return {
                element: (
                  <RequireAnonymous>
                    <Login />
                  </RequireAnonymous>
                ),
              };
            },
          },
          {
            path: 'pages/:id',
            lazy: async () => {
              const {PageDetail} = await import('./screens/modules/audit/pages/PageDetail');
              return {
                element: (
                  <RequireAuth>
                    <PageDetail />
                  </RequireAuth>
                ),
              };
            },
          },
          // Public and unauthenticated. The uuid is the only credential, which
          // is what makes the link shareable at all.
          {
            path: 'r/:uuid',
            handle: {sessionFree: true},
            lazy: async () => {
              const {Share} = await import('./screens/modules/audit/pages/Share');
              return {element: <Share />};
            },
          },
          {
            path: 'signup',
            lazy: async () => {
              const {Signup} = await import('./screens/modules/account/pages/Signup');
              return {
                element: (
                  <RequireAnonymous>
                    <Signup />
                  </RequireAnonymous>
                ),
              };
            },
          },
          {path: '*', element: <NotFound />},
        ],
      },
    ],
  },
];
