import {QueryClientProvider} from '@tanstack/react-query';
import {renderToString} from 'react-dom/server';
import {StaticRouterProvider, createStaticHandler, createStaticRouter} from 'react-router';
import {makeQueryClient} from './api/query-client';
import {routes} from './routes';

/**
 * The app's HTML for a path, rendered at build time by `scripts/prerender.ts`.
 *
 * The SAME `routes` and the same provider stack the browser uses. A second
 * route table here would be a second source of truth, and the failure would be
 * a hydration mismatch rather than anything that reads like a wrong answer.
 */
export const render = async (url: string): Promise<string> => {
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost${url}`));

  // A route that redirects has no HTML to prerender, and quietly writing the
  // redirect's body into index.html would ship the wrong page.
  if (context instanceof Response) {
    throw new Error(`${url} answered with ${context.status} instead of rendering`);
  }

  const router = createStaticRouter(routes, context);

  return renderToString(
    <QueryClientProvider client={makeQueryClient()}>
      <StaticRouterProvider router={router} context={context} />
    </QueryClientProvider>,
  );
};
