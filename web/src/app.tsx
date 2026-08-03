import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { routes } from './routes'

const router = createBrowserRouter(routes)

/**
 * The client is injected rather than constructed here so a spec gets its own -
 * a shared cache between tests makes one test's fetch another test's silent
 * cache hit, and the failure shows up in whichever test happens to run second.
 */
export const App = ({ queryClient }: { queryClient: QueryClient }): React.JSX.Element => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
)
