import type {QueryClient} from '@tanstack/react-query';
import type {RouteObject} from 'react-router';
import {Layout} from './screens/components/Layout';
import {NotFound} from './screens/components/NotFound';
import {RouteError} from './screens/components/RouteError';
import {requireAnonymous, requireSession} from './screens/modules/account/guards';
import {Home} from './screens/modules/audit/pages/Home';
import {LANDING_SECTIONS} from './screens/modules/audit/pages/Home/landing';

/**
 * Built from a `QueryClient` rather than exported as a constant, because the
 * guards are loaders now and a loader has no hooks to reach a provider with.
 * Handing it in keeps one cache per app - and one per test, which is what stops
 * a spec's fetch becoming the next spec's silent cache hit.
 *
 * Still plain data, so a spec can mount it with `createMemoryRouter` and assert
 * what each path resolves to - the routing is then tested as the app's own
 * configuration, not as a copy of it written in the test.
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
export const makeRoutes = (queryClient: QueryClient): RouteObject[] => [
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    // Rendered while a lazy route's chunk is in flight on a DIRECT visit.
    // `<Layout />`, not empty: a fallback declared on the ROOT route replaces
    // what that route renders, not just the page inside it. Empty here means no
    // skip link, no header, no route announcer for the whole window before the
    // chunk resolves, on every lazy route - the exact failure prerendering
    // exists to remove.
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
          // `ownMain`: Home renders its own <main> and a <footer> beside it. A
          // <footer> inside <main> is not a contentinfo landmark, so only the
          // route can put one there. The HEADER is shared, unlike before.
          //
          // `sessionFree`: the landing must cost a marketing visitor zero API
          // calls, so it reads the session cache and never fills it. A visitor
          // arriving from inside the app still gets their account header,
          // because the guards above have already warmed it.
          //
          // `sections`: the in-page anchors, declared in landing.tsx beside the
          // sections they point at. See Layout.
          {
            index: true,
            element: <Home />,
            handle: {ownMain: true, sessionFree: true, sections: LANDING_SECTIONS},
          },
          {
            path: 'dashboard',
            loader: requireSession(queryClient),
            lazy: async () => {
              const {Dashboard} = await import('./screens/modules/audit/pages/Dashboard');
              return {element: <Dashboard />};
            },
          },
          {
            path: 'login',
            loader: requireAnonymous(queryClient),
            lazy: async () => {
              const {Login} = await import('./screens/modules/account/pages/Login');
              return {element: <Login />};
            },
          },
          {
            path: 'pages/:id',
            loader: requireSession(queryClient),
            lazy: async () => {
              const {PageDetail} = await import('./screens/modules/audit/pages/PageDetail');
              return {element: <PageDetail />};
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
            path: 'docs/score-formula',
            handle: {sessionFree: true},
            lazy: async () => {
              const {ScoreFormula} = await import('./screens/modules/docs/pages/ScoreFormula');
              return {element: <ScoreFormula />};
            },
          },
          {
            path: 'signup',
            loader: requireAnonymous(queryClient),
            lazy: async () => {
              const {Signup} = await import('./screens/modules/account/pages/Signup');
              return {element: <Signup />};
            },
          },
          {path: '*', element: <NotFound />},
        ],
      },
    ],
  },
];
