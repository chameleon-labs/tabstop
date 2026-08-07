import {render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {describe, expect, it} from 'vitest';
import {NotFound} from './index';

const renderNotFound = (): void => {
  render(<RouterProvider router={createMemoryRouter([{path: '*', element: <NotFound />}])} />);
};

describe('NotFound', () => {
  it("is the page heading, not a note inside someone else's page", async () => {
    // An `h1`, because this replaced the screen. A heading outline still
    // claiming the previous page is how a screen reader user ends up believing
    // they are somewhere they are not.
    renderNotFound();

    expect(await screen.findByRole('heading', {level: 1, name: 'Page not found'})).toBeVisible();
  });

  it('names the likeliest cause rather than blaming the visitor', async () => {
    // The common case is a shared audit link that has since expired, and the
    // person holding it did nothing wrong.
    renderNotFound();

    expect(screen.getByText(/share link that has since expired/)).toBeVisible();
  });

  it('leaves a way out', async () => {
    renderNotFound();

    expect(screen.getByRole('link', {name: 'Back to the start'})).toHaveAttribute('href', '/');
  });

  it('names the page in the title, so the tab and the announcer agree', async () => {
    renderNotFound();
    await screen.findByRole('heading', {level: 1});

    expect(document.title).toBe('Page not found · tabstop');
  });
});
