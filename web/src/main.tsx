import {StrictMode} from 'react';
import {createBrowserRouter} from 'react-router';
import {App} from './app';
import {makeQueryClient} from './api/query-client';
import {isPrerenderedForPath, mountApp, mountWhenRouterReady} from './hydrate';
import {makeRoutes} from './routes';
import '@chameleon-labs/lattice-tokens/lattice.css';
import '@chameleon-labs/lattice-react/styles.css';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root is missing from index.html');
}

const queryClient = makeQueryClient();
const router = createBrowserRouter(makeRoutes(queryClient));

mountWhenRouterReady(isPrerenderedForPath(container, window.location.pathname), router, () =>
  mountApp(
    container,
    <StrictMode>
      <App queryClient={queryClient} router={router} />
    </StrictMode>,
    window.location.pathname,
  ),
);
