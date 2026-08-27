import {render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {describe, expect, it} from 'vitest';
import {NotFound} from './index';

const renderNotFound = (): void => {
  render(<RouterProvider router={createMemoryRouter([{path: '*', element: <NotFound />}])} />);
};

describe('NotFound', () => {
  it("is the page heading, not a note inside someone else's page", async () => {
    renderNotFound();

    expect(await screen.findByRole('heading', {level: 1, name: 'Page not found'})).toBeVisible();
  });

  it('names the likeliest cause rather than blaming the visitor', () => {
    renderNotFound();

    expect(screen.getByText(/share link that has since expired/)).toBeVisible();
  });

  it('leaves a way out', () => {
    renderNotFound();

    expect(screen.getByRole('link', {name: 'Back to the start'})).toHaveAttribute('href', '/');
  });

  it('names the page in the title, so the tab and the announcer agree', async () => {
    renderNotFound();
    await screen.findByRole('heading', {level: 1});

    expect(document.title).toBe('Page not found · tabstop');
  });
});
