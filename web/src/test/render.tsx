import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, type RenderResult} from '@testing-library/react';
import {StrictMode, useState} from 'react';
import {RouterProvider, createMemoryRouter, type InitialEntry} from 'react-router';
import {makeRoutes} from '../routes';

export type AppMemoryRouter = ReturnType<typeof createMemoryRouter>;

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

export const Providers = ({children}: ProvidersProps): React.JSX.Element => {
  const [router] = useState(() => createMemoryRouter([{path: '*', element: <>{children}</>}]));
  const [queryClient] = useState(testQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
};

export const wrapper = Providers;

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

  const result = render(strict ? <StrictMode>{tree}</StrictMode> : tree);

  return {...result, router};
};
