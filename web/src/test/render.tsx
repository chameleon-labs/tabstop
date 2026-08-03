import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { routes } from '../routes'

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
export const renderAt = (path: string): RenderResult => {
  const queryClient = new QueryClient({
    defaultOptions: {
      // No retries: a test asserting an error path should not wait out a
      // backoff schedule to see it.
      queries: { retry: false },
      mutations: { retry: false }
    }
  })
  const router = createMemoryRouter(routes, { initialEntries: [path] })

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
