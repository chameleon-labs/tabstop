import {QueryClientProvider, type QueryClient} from '@tanstack/react-query';
import {RouterProvider, type createBrowserRouter} from 'react-router';

/** Whatever `createBrowserRouter` or `createMemoryRouter` returns. */
export type AppRouter = ReturnType<typeof createBrowserRouter>;

export type AppProps = {
  queryClient: QueryClient;
  router: AppRouter;
};

/**
 * The providers, and nothing else. Both collaborators are injected.
 *
 * NEITHER may be constructed in here, and the router is the one that bites.
 * `main.tsx` renders this inside `StrictMode`, which deliberately invokes
 * component bodies AND `useState` initialisers twice on mount to surface
 * exactly this class of bug - and `createBrowserRouter` calls `initialize()`,
 * which subscribes to browser history. Building it here therefore creates two
 * routers, both listening, one of them orphaned with no way to dispose it. A
 * lazy initialiser does not help: it is double-invoked too, which was measured
 * rather than assumed.
 *
 * The query client is injected for a related reason - a client shared between
 * tests turns one test's fetch into the next one's silent cache hit, and the
 * failure surfaces in whichever happened to run second.
 */
export const App = ({queryClient, router}: AppProps): React.JSX.Element => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
