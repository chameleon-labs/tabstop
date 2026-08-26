import {act, render} from '@testing-library/react';
import {Outlet, RouterProvider, createMemoryRouter} from 'react-router';
import {vi} from 'vitest';

export type HeldChunk = {
  arrive: () => Promise<void>;
  lazy: () => Promise<{element: React.JSX.Element}>;
};

export const heldChunk = (screen: React.JSX.Element = <p>the slow screen</p>): HeldChunk => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    arrive: async (): Promise<void> => {
      release?.();
      await act(async () => {
        await held;
      });
    },
    lazy: async () => {
      await held;
      return {element: screen};
    },
  };
};

export type SlowRoute = {
  router: ReturnType<typeof createMemoryRouter>;
  leave: () => Promise<void>;
};

export const renderSlowRoute = (shell: React.ReactNode, chunk: HeldChunk): SlowRoute => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <>
            {shell}
            <Outlet />
          </>
        ),
        children: [
          {index: true, element: <p>home</p>},
          {path: 'slow', lazy: chunk.lazy},
        ],
      },
    ],
    {initialEntries: ['/']},
  );

  render(<RouterProvider router={router} />);

  return {
    router,
    leave: async (): Promise<void> => {
      await act(async () => {
        void router.navigate('/slow');
        await Promise.resolve();
      });
    },
  };
};

export const advanceTimers = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
