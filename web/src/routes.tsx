import type {QueryClient} from '@tanstack/react-query';
import type {RouteObject} from 'react-router';
import {Layout} from './screens/components/Layout';
import {NotFound} from './screens/components/NotFound';
import {RouteError} from './screens/components/RouteError';
import {RouteSkeleton} from './screens/components/RouteSkeleton';
import {requireAnonymous, requireSession} from './screens/modules/account/guards';
import {Home} from './screens/modules/audit/pages/Home';
import {LANDING_SECTIONS} from './screens/modules/audit/pages/Home/landing';

export const makeRoutes = (queryClient: QueryClient): RouteObject[] => [
  {
    path: '/',
    element: <Layout />,
    errorElement: <RouteError />,
    hydrateFallbackElement: (
      <Layout>
        <RouteSkeleton />
      </Layout>
    ),
    children: [
      {
        errorElement: <RouteError />,
        children: [
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
