import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { routes } from './routes'

export type AppProps = {
  queryClient: QueryClient
}

/**
 * The client is injected rather than constructed here so a spec gets its own -
 * a shared cache between tests makes one test's fetch another test's silent
 * cache hit, and the failure shows up in whichever test happens to run second.
 *
 * The ROUTER is built in a lazy initialiser rather than at module scope, which
 * is the more usual placement. Two reasons, and the second is why:
 *
 * - `createBrowserRouter` reads `window.location` and subscribes to history, so
 *   at module scope that is a side effect of merely IMPORTING this file.
 * - It snapshots the location when it is created. At module scope that happens
 *   the moment the import graph is evaluated, so nothing that runs afterwards
 *   can decide where the app starts - which made it impossible to mount the app
 *   anywhere but `/` in a test, and would do the same to any future entry point.
 *
 * `useState` and not a plain call: the router must be identical across renders,
 * and constructing it in the body would hand `RouterProvider` a new one each
 * time and throw the history away with it.
 */
export const App = ({ queryClient }: AppProps): React.JSX.Element => {
  const [router] = useState(() => createBrowserRouter(routes))

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
