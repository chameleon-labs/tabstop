import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, type RenderResult} from '@testing-library/react';
import {StrictMode, useState} from 'react';
import {RouterProvider, createMemoryRouter, type InitialEntry} from 'react-router';
import {makeRoutes} from '../routes';

export type AppMemoryRouter = ReturnType<typeof createMemoryRouter>;

/**
 * No retries: a spec asserting an error path should not wait out a backoff
 * schedule to see it. The real policy is `makeQueryClient`, tested directly in
 * `api/query-client.spec.ts` rather than incidentally through every render.
 */
const testQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {retry: false},
      mutations: {retry: false},
    },
  });

export type ProvidersProps = {
  children: React.ReactNode;
};

/**
 * Everything a component needs to render outside the app: a router, because
 * `useLocation`, `Navigate` and `Link` all require one, and a query client with
 * its own cache.
 *
 * The route is `*`, so whatever is under test renders whatever the path is -
 * a component spec should not have to know which URL it happens to live at.
 */
export const Providers = ({children}: ProvidersProps): React.JSX.Element => {
  // Lazy initialisers, not plain calls. A component body runs on every render,
  // so building these inline would hand a NEW router and an empty cache to each
  // one - `renderHook(...).rerender()` would then measure a remount rather than
  // the hook, and a cached query would look like a refetch. Production keeps
  // both for the life of the app; a wrapper that does not is testing something
  // else.
  const [router] = useState(() => createMemoryRouter([{path: '*', element: <>{children}</>}]));
  const [queryClient] = useState(testQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
};

/** For `renderHook`, which takes a wrapper rather than an element. */
export const wrapper = Providers;

/**
 * The app's real route table, mounted at a chosen path - or at a whole entry,
 * for the screens that read `location.state`.
 *
 * `makeRoutes` is called rather than a table rebuilt here on purpose: a test
 * that declares its own routes asserts that React Router works, which is not in
 * doubt. This asserts that OUR configuration resolves the way we think.
 *
 * A fresh `QueryClient` per call, because a shared cache turns one test's fetch
 * into the next test's silent cache hit - and the failure then appears in
 * whichever test happened to run second. The SAME one reaches the guards and
 * the provider, as in `main.tsx`: two would make a guarded page cost two
 * requests here and one in production, which is the wrong way round.
 */
export const renderAt = (
  path: InitialEntry,
  {strict = false}: {strict?: boolean} = {},
): RenderResult & {router: AppMemoryRouter} => {
  const queryClient = testQueryClient();
  const router = createMemoryRouter(makeRoutes(queryClient), {initialEntries: [path]});

  const tree = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );

  // `main.tsx` renders inside `StrictMode`, which invokes every mount effect
  // twice in development. Off by default because it doubles the renders in
  // every spec; on where a screen ACTS on mount, and firing twice is a bug a
  // production build would never show.
  const result = render(strict ? <StrictMode>{tree}</StrictMode> : tree);

  // Returned so a spec can navigate the way the app does. `window.history` is
  // not an option: a memory router does not listen to it, and a spec that goes
  // through the window asserts nothing at all.
  return {...result, router};
};
