import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import { useState } from 'react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { routes } from '../routes'

export type AppMemoryRouter = ReturnType<typeof createMemoryRouter>

/**
 * No retries: a spec asserting an error path should not wait out a backoff
 * schedule to see it. The real policy is `makeQueryClient`, tested directly in
 * `api/query-client.spec.ts` rather than incidentally through every render.
 */
const testQueryClient = (): QueryClient => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
    mutations: { retry: false }
  }
})

export type ProvidersProps = {
  children: React.ReactNode
}

/**
 * Everything a component needs to render outside the app: a router, because
 * `useLocation`, `Navigate` and `Link` all require one, and a query client with
 * its own cache.
 *
 * The route is `*`, so whatever is under test renders whatever the path is -
 * a component spec should not have to know which URL it happens to live at.
 */
export const Providers = ({ children }: ProvidersProps): React.JSX.Element => {
  // Lazy initialisers, not plain calls. A component body runs on every render,
  // so building these inline would hand a NEW router and an empty cache to each
  // one - `renderHook(...).rerender()` would then measure a remount rather than
  // the hook, and a cached query would look like a refetch. Production keeps
  // both for the life of the app; a wrapper that does not is testing something
  // else.
  const [router] = useState(() => createMemoryRouter([{ path: '*', element: <>{children}</> }]))
  const [queryClient] = useState(testQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

/** For `renderHook`, which takes a wrapper rather than an element. */
export const wrapper = Providers

/**
 * The app's real route table, mounted at a chosen path.
 *
 * `routes` is imported rather than rebuilt here on purpose: a test that
 * declares its own routes asserts that React Router works, which is not in
 * doubt. This asserts that OUR configuration resolves the way we think.
 *
 * A fresh `QueryClient` per call, because a shared cache turns one test's fetch
 * into the next test's silent cache hit - and the failure then appears in
 * whichever test happened to run second.
 */
export const renderAt = (path: string): RenderResult & { router: AppMemoryRouter } => {
  const router = createMemoryRouter(routes, { initialEntries: [path] })

  const result = render(
    <QueryClientProvider client={testQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  // Returned so a spec can navigate the way the app does. `window.history` is
  // not an option: a memory router does not listen to it, and a spec that goes
  // through the window asserts nothing at all.
  return { ...result, router }
}
