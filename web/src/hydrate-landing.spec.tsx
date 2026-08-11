import {act, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {StrictMode} from 'react';
import {createBrowserRouter} from 'react-router';
import {afterEach, describe, expect, it} from 'vitest';
import {App} from './app';
import {makeQueryClient} from './api/query-client';
import {render as prerender} from './entry-server';
import {mountApp} from './hydrate';
import {makeRoutes} from './routes';

describe('the prerendered landing page', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hydrates without React discarding the markup', async () => {
    // The assertion for "cleanly" is the console gate in `vitest.setup.ts`:
    // React reports a hydration mismatch through console.error, and the gate
    // fails any test that writes there. What is asserted explicitly is that the
    // page is INTERACTIVE afterwards, which the gate cannot see.
    const container = document.createElement('div');
    container.dataset.prerendered = '/';
    container.innerHTML = await prerender('/');
    document.body.append(container);

    const queryClient = makeQueryClient();
    const router = createBrowserRouter(makeRoutes(queryClient));

    act(() => {
      mountApp(
        container,
        <StrictMode>
          <App queryClient={queryClient} router={router} />
        </StrictMode>,
        '/',
      );
    });

    const field = await screen.findByLabelText('Page to audit');
    await userEvent.type(field, 'example.com');

    expect(field).toHaveValue('example.com');
  });
});
