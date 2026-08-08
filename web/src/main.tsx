import {StrictMode} from 'react';
import {createBrowserRouter} from 'react-router';
import {App} from './app';
import {makeQueryClient} from './api/query-client';
import {mountApp} from './hydrate';
import {routes} from './routes';
// Tokens before components, and both before the app's own sheet. `lattice.css`
// declares the custom properties `styles.css` reads, so the reverse order
// leaves every colour and spacing value resolving to nothing.
import '@chameleon-labs/lattice-tokens/lattice.css';
import '@chameleon-labs/lattice-react/styles.css';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('#root is missing from index.html');
}

/**
 * Built OUT HERE, above the render, and that placement is load-bearing.
 *
 * `createBrowserRouter` subscribes to browser history the moment it is called.
 * Anywhere inside the `StrictMode` subtree - component body or `useState`
 * initialiser, both are double-invoked in development - that means two routers
 * listening and one abandoned. Constructed once at the entry point, there is
 * exactly one for the life of the page.
 */
const router = createBrowserRouter(routes);

mountApp(
  container,
  <StrictMode>
    <App queryClient={makeQueryClient()} router={router} />
  </StrictMode>,
  window.location.pathname,
);
