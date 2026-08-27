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
