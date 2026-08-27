import {QueryClientProvider} from '@tanstack/react-query';
import {renderToString} from 'react-dom/server';
import {StaticRouterProvider, createStaticHandler, createStaticRouter} from 'react-router';
import {makeQueryClient} from './api/query-client';
import {makeRoutes} from './routes';

export const render = async (url: string): Promise<string> => {
  const queryClient = makeQueryClient();
  const routes = makeRoutes(queryClient);
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost${url}`));

  if (context instanceof Response) {
    throw new Error(`${url} answered with ${context.status} instead of rendering`);
  }

  const router = createStaticRouter(handler.dataRoutes, context);

  return renderToString(
    <QueryClientProvider client={queryClient}>
      <StaticRouterProvider router={router} context={context} />
    </QueryClientProvider>,
  );
};

export {injectAppShell, injectMarkup} from './prerender/inject';
export {assertBuildOutput} from './prerender/verify';
