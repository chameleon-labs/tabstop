import {render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {describe, expect, it} from 'vitest';
import {Share} from './index';

const renderAtUuid = (uuid: string): void => {
  render(
    <RouterProvider
      router={createMemoryRouter([{path: '/r/:uuid', element: <Share />}], {initialEntries: [`/r/${uuid}`]})}
    />,
  );
};

describe('Share', () => {
  it('reads the uuid out of the path, which is the only credential it gets', async () => {
    renderAtUuid('7a1f-abc');

    expect(await screen.findByRole('heading', {level: 1, name: 'Audit result'})).toBeVisible();
    expect(screen.getByText(/7a1f-abc/)).toBeVisible();
  });

  it('renders with no session and asks for none', async () => {
    // Requiring one would defeat the point of a link you can send to a
    // colleague. Asserted on the absence of any request, because a screen that
    // merely rendered while signed out could still be one `useSession` away
    // from gating itself.
    const fetchSpy = (): never => {
      throw new Error('Share must not call the API for identity');
    };
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      renderAtUuid('7a1f-abc');

      expect(await screen.findByRole('heading', {level: 1, name: 'Audit result'})).toBeVisible();
    } finally {
      globalThis.fetch = original;
    }
  });

  it('names the page in the title', async () => {
    renderAtUuid('7a1f-abc');
    await screen.findByRole('heading', {level: 1});

    expect(document.title).toBe('Audit result · tabstop');
  });
});
