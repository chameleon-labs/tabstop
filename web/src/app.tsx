import {QueryClientProvider, type QueryClient} from '@tanstack/react-query';
import {RouterProvider, type createBrowserRouter} from 'react-router';

export type AppRouter = ReturnType<typeof createBrowserRouter>;

export type AppProps = {
  queryClient: QueryClient;
  router: AppRouter;
};

export const App = ({queryClient, router}: AppProps): React.JSX.Element => (
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
