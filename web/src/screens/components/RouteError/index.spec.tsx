import {render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {describe, expect, it} from 'vitest';
import {RouteError} from './index';
import {ApiError} from '@/api/client';

const renderThrowing = (error: unknown): void => {
  const Boom = (): React.JSX.Element => {
    throw error;
  };

  const router = createMemoryRouter([{path: '/', element: <Boom />, errorElement: <RouteError />}], {
    initialEntries: ['/'],
  });

  render(<RouterProvider router={router} />);
};

const renderLoaderThrowing = (response: Response): void => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        loader: () => {
          throw response;
        },
        element: <h1>Never rendered</h1>,
        HydrateFallback: () => <p>Loading</p>,
        errorElement: <RouteError />,
      },
    ],
    {initialEntries: ['/']},
  );

  render(<RouterProvider router={router} />);
};

describe('RouteError', () => {
  describe('a 404, which is not a crash', () => {
    it('renders the not-found page for an ApiError 404', async () => {
      renderThrowing(new ApiError(404, 'Audit not found', {error: 'Audit not found'}));

      expect(await screen.findByRole('heading', {level: 1, name: 'Page not found'})).toBeVisible();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('renders it for a router ErrorResponse 404 as well', async () => {
      renderLoaderThrowing(new Response(null, {status: 404, statusText: 'Not Found'}));

      expect(await screen.findByRole('heading', {level: 1, name: 'Page not found'})).toBeVisible();
    });

    it('does not treat every ApiError as a 404', async () => {
      renderThrowing(new ApiError(403, 'Forbidden', {error: 'Forbidden'}));

      expect(await screen.findByRole('heading', {level: 1, name: 'Something went wrong'})).toBeVisible();
    });
  });

  describe('a real failure', () => {
    it('shows the sentence the server wrote', async () => {
      renderThrowing(new ApiError(500, 'The audit service is unavailable', null));

      expect(await screen.findByRole('heading', {level: 1, name: 'Something went wrong'})).toBeVisible();
      expect(screen.getByText('The audit service is unavailable')).toBeVisible();
    });

    it('shows a router error response by its status text', async () => {
      renderLoaderThrowing(new Response(null, {status: 503, statusText: 'Service Unavailable'}));

      expect(await screen.findByText('Service Unavailable')).toBeVisible();
    });

    it('does not render an empty paragraph when there is no status text', async () => {
      renderLoaderThrowing(new Response(null, {status: 503}));

      await screen.findByRole('heading', {level: 1, name: 'Something went wrong'});
      expect(screen.getByText(/do not have a useful explanation/)).toBeVisible();
    });

    it('says nothing specific about an error written for a developer', async () => {
      renderThrowing(new TypeError('Cannot read properties of undefined (reading foo)'));

      expect(await screen.findByRole('heading', {level: 1, name: 'Something went wrong'})).toBeVisible();
      expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument();
      expect(screen.getByText(/do not have a useful explanation/)).toBeVisible();
    });

    it('always leaves a way out', async () => {
      renderThrowing(new TypeError('boom'));

      expect(await screen.findByRole('link', {name: 'Back to the start'})).toHaveAttribute('href', '/');
    });

    it('names the page in the title, so the tab and the announcer agree', async () => {
      renderThrowing(new ApiError(500, 'Nope', null));
      await screen.findByRole('heading', {level: 1, name: 'Something went wrong'});

      expect(document.title).toBe('Something went wrong · tabstop');
    });
  });
});
