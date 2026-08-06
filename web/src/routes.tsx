import type { RouteObject } from 'react-router'
import { Layout } from './components/Layout'
import { NotFound } from './components/NotFound'
import { RequireAuth } from './components/RequireAuth'
import { RouteError } from './components/RouteError'
import { Dashboard } from './screens/Dashboard'
import { Home } from './screens/Home'
import { PageDetail } from './screens/PageDetail'
import { Share } from './screens/Share'
import { Signup } from './screens/Signup'

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
    children: [
      {
        errorElement: <RouteError />,
        children: [
          // Declares that Home renders its own header, main and footer: its
          // design carries a nav and footer, and nesting those inside the
          // shell's would produce two banners and a nested <main>. See Layout.
          { index: true, element: <Home />, handle: { ownChrome: true } },
          { path: 'dashboard', element: <RequireAuth><Dashboard /></RequireAuth> },
          { path: 'pages/:id', element: <RequireAuth><PageDetail /></RequireAuth> },
          // Public and unauthenticated. The uuid is the only credential, which
          // is what makes the link shareable at all.
          { path: 'r/:uuid', element: <Share /> },
          // Public: the rate-limit offer on the home screen links here, and it
          // is the one link this app shows to someone who is not signed in and
          // has just been told to stop.
          { path: 'signup', element: <Signup /> },
          { path: '*', element: <NotFound /> }
        ]
      }
    ]
  }
]
