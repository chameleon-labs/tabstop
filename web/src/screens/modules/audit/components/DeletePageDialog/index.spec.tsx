import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {describe, expect, it, vi} from 'vitest';
import type {PageSummary} from '@tabstop/contract';
import {DeletePageDialog} from './index';

const page = (id = 'page-1'): PageSummary => ({
  id,
  url: `https://example.test/${id}`,
  monitoringEnabled: true,
  createdAt: '2026-08-01T10:00:00.000Z',
  domain: 'example.test',
  latestAudit: null,
  score: null,
  previousScore: null,
  history: [],
});

const deferred = <T,>(): {promise: Promise<T>; resolve: (value: T) => void} => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return {promise, resolve};
};

type HarnessProps = {
  onConfirm: (target: PageSummary) => Promise<boolean>;
  target?: PageSummary;
};

/** A real trigger outside the dialog, because Ariakit restores focus to it. */
const Harness = ({onConfirm, target = page()}: HarnessProps): React.JSX.Element => {
  const [open, setOpen] = useState(true);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);

  return (
    <>
      <button
        type="button"
        ref={setTrigger}
        onClick={() => {
          setOpen(true);
        }}
      >
        Remove {target.url}
      </button>
      <DeletePageDialog open={open} target={target} trigger={trigger} onOpenChange={setOpen} onConfirm={onConfirm} />
    </>
  );
};

const dialog = (): HTMLElement => screen.getByRole('dialog');
const removeButton = (): HTMLElement => screen.getByRole('button', {name: /Remove page|Removing/});

describe('DeletePageDialog', () => {
  it('names the action and the page it would remove', async () => {
    render(<Harness onConfirm={vi.fn()} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    expect(dialog()).toHaveAccessibleName('Remove monitored page?');
    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining('https://example.test/page-1'));
  });

  it('says what is destroyed, since none of it comes back', async () => {
    // The cascade takes the audit history and every public share link with
    // it, and there is no undo behind this button.
    render(<Harness onConfirm={vi.fn()} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining('audit history'));
    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining('share link'));
    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining('permanently'));
  });

  it('offers exactly two ways out', async () => {
    render(<Harness onConfirm={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', {name: 'Cancel'})).toBeVisible();
    });
    expect(screen.getByRole('button', {name: 'Remove page'})).toBeVisible();
  });

  it('traps focus and puts Cancel ahead of the destructive button', async () => {
    // Where focus actually LANDS is checked in a browser: Ariakit resolves
    // `initialFocus` on an animation frame, and jsdom leaves it on the dialog
    // container. What is provable here is the containment and the order that
    // makes Cancel the safe default in the first place.
    render(<Harness onConfirm={vi.fn()} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });

    expect(dialog().contains(document.activeElement)).toBe(true);

    const controls = [...dialog().querySelectorAll('button')].map((button) => button.textContent);
    expect(controls).toEqual(['Cancel', 'Remove page']);
  });

  it('cancels without removing anything', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    await user.click(screen.getByRole('button', {name: 'Cancel'}));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('closes on Escape while it is idle', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  describe('while the removal is in flight', () => {
    it('says so and locks both answers', async () => {
      const user = userEvent.setup();
      const pending = deferred<boolean>();
      render(<Harness onConfirm={vi.fn(async () => await pending.promise)} />);

      await waitFor(() => {
        expect(dialog()).toBeVisible();
      });
      await user.click(removeButton());

      expect(screen.getByRole('button', {name: 'Removing…'})).toBeDisabled();
      expect(screen.getByRole('button', {name: 'Cancel'})).toBeDisabled();

      await act(async () => {
        pending.resolve(false);
        await Promise.resolve();
      });
    });

    it('ignores Escape, so a half-finished removal cannot be walked away from', async () => {
      // The request lands either way, and this dialog is the only thing that
      // will report which way it landed.
      const user = userEvent.setup();
      const pending = deferred<boolean>();
      const onOpenChange = vi.fn();
      render(
        <DeletePageDialog
          open
          target={page()}
          trigger={null}
          onOpenChange={onOpenChange}
          onConfirm={vi.fn(async () => await pending.promise)}
        />,
      );

      await waitFor(() => {
        expect(dialog()).toBeVisible();
      });
      await user.click(removeButton());
      await user.keyboard('{Escape}');
      await act(async () => {
        await Promise.resolve();
      });

      expect(onOpenChange).not.toHaveBeenCalled();
      expect(dialog()).toBeVisible();

      await act(async () => {
        pending.resolve(false);
        await Promise.resolve();
      });
    });

    it('sends exactly one removal however often the button is pressed', async () => {
      // Submitted directly: the button is already disabled, and the guard has
      // to hold for anything that reaches the handler another way.
      const user = userEvent.setup();
      const pending = deferred<boolean>();
      const onConfirm = vi.fn(async () => await pending.promise);
      render(<DeletePageDialog open target={page()} trigger={null} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

      await waitFor(() => {
        expect(dialog()).toBeVisible();
      });
      await user.click(removeButton());
      await act(async () => {
        fireEvent.click(removeButton());
        await Promise.resolve();
      });

      expect(onConfirm).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve(false);
        await Promise.resolve();
      });
    });

    it('recovers its controls when the screen switches to another page', async () => {
      // Without a reset keyed on the target, a dialog reopened for a different
      // page inherits the previous one's in-flight state and stays locked.
      const user = userEvent.setup();
      const pending = deferred<boolean>();
      const {rerender} = render(
        <DeletePageDialog
          open
          target={page('page-1')}
          trigger={null}
          onOpenChange={vi.fn()}
          onConfirm={vi.fn(async () => await pending.promise)}
        />,
      );

      await waitFor(() => {
        expect(dialog()).toBeVisible();
      });
      await user.click(removeButton());
      expect(screen.getByRole('button', {name: 'Removing…'})).toBeDisabled();

      rerender(
        <DeletePageDialog open target={page('page-2')} trigger={null} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
      );

      expect(screen.getByRole('button', {name: 'Remove page'})).toBeEnabled();
      expect(screen.getByRole('button', {name: 'Cancel'})).toBeEnabled();

      await act(async () => {
        pending.resolve(false);
        await Promise.resolve();
      });
    });
  });

  it('stays open and usable when removal fails', async () => {
    const user = userEvent.setup();
    const pending = deferred<boolean>();
    render(<Harness onConfirm={vi.fn(async () => await pending.promise)} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    await user.click(removeButton());

    await act(async () => {
      pending.resolve(false);
      await Promise.resolve();
    });

    expect(dialog()).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole('button', {name: 'Remove page'})).toBeEnabled();
    });
    expect(screen.getByRole('button', {name: 'Cancel'})).toBeEnabled();
  });

  it('closes once, and only once, on success', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn(async () => await Promise.resolve(true));
    render(<DeletePageDialog open target={page()} trigger={null} onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    await user.click(removeButton());

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith(page());
    });
    expect(onOpenChange.mock.calls.filter(([next]) => next === false)).toHaveLength(1);
  });

  it('confirms nothing when there is no target', async () => {
    const onConfirm = vi.fn();
    render(<DeletePageDialog open target={null} trigger={null} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('forgets a previous failure when a different page is chosen', async () => {
    const user = userEvent.setup();
    const pending = deferred<boolean>();
    const {rerender} = render(
      <DeletePageDialog
        open
        target={page('page-1')}
        trigger={null}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn(async () => await pending.promise)}
      />,
    );

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    await user.click(removeButton());
    await act(async () => {
      pending.resolve(false);
      await Promise.resolve();
    });

    rerender(
      <DeletePageDialog open target={page('page-2')} trigger={null} onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining('https://example.test/page-2'));
    expect(screen.getByRole('button', {name: 'Remove page'})).toBeEnabled();
  });

  it('renders the page url as text, whatever it contains', async () => {
    const hostile = {...page(), url: 'https://example.test/<img src=x onerror=alert(1)>'};
    render(<DeletePageDialog open target={hostile} trigger={null} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    expect(dialog().querySelector('img')).toBeNull();
    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining('<img src=x onerror=alert(1)>'));
  });

  it('leaves one h1 to the page, so the dialog heading nests under it', async () => {
    render(<Harness onConfirm={vi.fn()} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    expect(screen.queryByRole('heading', {level: 1})).not.toBeInTheDocument();
    expect(screen.getByRole('heading', {level: 2, name: 'Remove monitored page?'})).toBeVisible();
  });

  it('does not fire a stray close when a keystroke lands outside it', async () => {
    const onOpenChange = vi.fn();
    render(<DeletePageDialog open target={page()} trigger={null} onOpenChange={onOpenChange} onConfirm={vi.fn()} />);

    await waitFor(() => {
      expect(dialog()).toBeVisible();
    });
    fireEvent.keyDown(dialog(), {key: 'a'});

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
