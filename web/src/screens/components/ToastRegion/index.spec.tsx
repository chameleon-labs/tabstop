import {act, fireEvent, render, renderHook, screen, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  MAX_VISIBLE_TOASTS,
  TOAST_ANNOUNCEMENT_GAP_MS,
  TOAST_DURATION_MS,
  type ToastMessage,
  ToastRegion,
  useToastQueue,
} from './index';

const toast = (id: string, message: string, overrides: Partial<ToastMessage> = {}): ToastMessage => ({
  id,
  variant: 'success',
  message,
  ...overrides,
});

const advance = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('useToastQueue', () => {
  it('keeps one copy of a message that is already on screen', () => {
    // Two failing rows produce the same sentence; stacking it twice says
    // nothing the first copy did not.
    const {result} = renderHook(() => useToastQueue());

    act(() => {
      result.current.push({variant: 'success', message: 'Page added'});
      result.current.push({variant: 'success', message: 'Page added'});
    });

    expect(result.current.toasts).toHaveLength(1);
  });

  it('separates the same message under a different variant', () => {
    const {result} = renderHook(() => useToastQueue());

    act(() => {
      result.current.push({variant: 'success', message: 'Monitoring changed'});
      result.current.push({variant: 'danger', message: 'Monitoring changed'});
    });

    expect(result.current.toasts).toHaveLength(2);
  });

  it('allows a message again once the first has gone', () => {
    // Deduplicating forever would silently swallow the second failure of a
    // retried action.
    const {result} = renderHook(() => useToastQueue());

    act(() => {
      result.current.push({variant: 'danger', message: 'Could not pause monitoring'});
    });
    act(() => {
      result.current.dismiss(result.current.toasts[0]!.id);
    });
    act(() => {
      result.current.push({variant: 'danger', message: 'Could not pause monitoring'});
    });

    expect(result.current.toasts).toHaveLength(1);
  });

  it('gives every message its own identity', () => {
    const {result} = renderHook(() => useToastQueue());

    act(() => {
      result.current.push({variant: 'success', message: 'One'});
      result.current.push({variant: 'success', message: 'Two'});
    });

    const [first, second] = result.current.toasts;
    expect(first!.id).not.toBe(second!.id);
  });

  it('dismisses only the message asked for', () => {
    const {result} = renderHook(() => useToastQueue());

    act(() => {
      result.current.push({variant: 'success', message: 'One'});
      result.current.push({variant: 'success', message: 'Two'});
    });
    act(() => {
      result.current.dismiss(result.current.toasts[0]!.id);
    });

    expect(result.current.toasts.map(({message}) => message)).toEqual(['Two']);
  });
});

describe('ToastRegion semantics', () => {
  it('names its dismiss control after the message it removes', () => {
    render(<ToastRegion toasts={[toast('a', 'Page added: https://example.test/')]} onDismiss={vi.fn()} />);

    expect(screen.getByRole('button', {name: 'Dismiss Page added: https://example.test/'})).toBeVisible();
  });

  it('leaves announcing to one live region rather than every toast', () => {
    // A `role="alert"` per toast announces content the live region has
    // already sent, so each message is read twice.
    render(<ToastRegion toasts={[toast('a', 'One'), toast('b', 'Two', {variant: 'danger'})]} onDismiss={vi.fn()} />);

    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('marks each toast with its variant and an icon that is not announced', () => {
    const {container} = render(
      <ToastRegion toasts={[toast('a', 'Saved', {variant: 'warning'})]} onDismiss={vi.fn()} />,
    );
    const item = container.querySelector('.toast')!;

    expect(item).toHaveAttribute('data-variant', 'warning');
    expect(within(item as HTMLElement).getByText('Saved')).toBeVisible();
    expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows an action only when one was supplied', () => {
    const onClick = vi.fn();
    const {rerender} = render(<ToastRegion toasts={[toast('a', 'Already tracked')]} onDismiss={vi.fn()} />);

    expect(screen.queryByRole('button', {name: 'View page'})).not.toBeInTheDocument();

    rerender(
      <ToastRegion
        toasts={[toast('a', 'Already tracked', {action: {label: 'View page', onClick}})]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', {name: 'View page'})).toBeVisible();
  });

  it('shows at most three at once and keeps the rest waiting', () => {
    const four = ['One', 'Two', 'Three', 'Four'].map((message, index) => toast(`t${index}`, message));
    const {rerender} = render(<ToastRegion toasts={four} onDismiss={vi.fn()} />);

    expect(screen.getAllByRole('button', {name: /^Dismiss/})).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(screen.queryByText('Four')).not.toBeInTheDocument();

    rerender(<ToastRegion toasts={four.slice(1)} onDismiss={vi.fn()} />);

    expect(screen.getByText('Four')).toBeVisible();
  });
});

describe('ToastRegion timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([{variant: 'success' as const}, {variant: 'info' as const}])(
    'dismisses a $variant message once it has been read',
    async ({variant}) => {
      const onDismiss = vi.fn();
      render(<ToastRegion toasts={[toast('a', 'Page added', {variant})]} onDismiss={onDismiss} />);

      await advance(TOAST_DURATION_MS - 1);
      expect(onDismiss).not.toHaveBeenCalled();

      await advance(1);
      expect(onDismiss).toHaveBeenCalledExactlyOnceWith('a');
    },
  );

  it.each([{variant: 'warning' as const}, {variant: 'danger' as const}])(
    'keeps a $variant message until it is dismissed',
    async ({variant}) => {
      // These report something the user has to act on. Timing them out decides
      // for them that it did not matter.
      const onDismiss = vi.fn();
      render(<ToastRegion toasts={[toast('a', 'Could not remove that page', {variant})]} onDismiss={onDismiss} />);

      await advance(20_000);

      expect(onDismiss).not.toHaveBeenCalled();
      expect(screen.getByText('Could not remove that page')).toBeVisible();
    },
  );

  it('pauses while hovered and resumes with the time that was left', async () => {
    const onDismiss = vi.fn();
    const {container} = render(<ToastRegion toasts={[toast('a', 'Page added')]} onDismiss={onDismiss} />);
    const item = container.querySelector('.toast')!;

    await advance(2_000);
    fireEvent.mouseEnter(item);
    await advance(60_000);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(item);
    await advance(2_999);
    expect(onDismiss).not.toHaveBeenCalled();

    await advance(1);
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('pauses while focus is inside it, so a keyboard user can reach the action', async () => {
    const onDismiss = vi.fn();
    const {container} = render(
      <ToastRegion
        toasts={[toast('a', 'Already tracked', {variant: 'info', action: {label: 'View page', onClick: vi.fn()}})]}
        onDismiss={onDismiss}
      />,
    );
    const item = container.querySelector('.toast')!;

    await advance(1_000);
    fireEvent.focusIn(item);
    await advance(60_000);
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.focusOut(item);
    await advance(TOAST_DURATION_MS - 1_000);
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('stays paused while both hover and focus are active', async () => {
    const onDismiss = vi.fn();
    const {container} = render(<ToastRegion toasts={[toast('a', 'Page added')]} onDismiss={onDismiss} />);
    const item = container.querySelector('.toast')!;

    fireEvent.mouseEnter(item);
    fireEvent.focusIn(item);
    fireEvent.mouseLeave(item);
    await advance(60_000);

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('runs an action once and then gets out of the way', () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ToastRegion
        toasts={[toast('a', 'Already tracked', {variant: 'info', action: {label: 'View page', onClick}})]}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', {name: 'View page'}));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('a');
  });

  it('leaves no timer running when it goes away', async () => {
    const {unmount} = render(<ToastRegion toasts={[toast('a', 'Page added')]} onDismiss={vi.fn()} />);

    await advance(100);
    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('announces two messages in turn rather than talking over itself', async () => {
    render(<ToastRegion toasts={[toast('a', 'Page added'), toast('b', 'Monitoring paused')]} onDismiss={vi.fn()} />);

    await advance(0);
    expect(screen.getByRole('status')).toHaveTextContent('Page added');

    await advance(TOAST_ANNOUNCEMENT_GAP_MS);
    expect(screen.getByRole('status')).toHaveTextContent('Monitoring paused');
  });

  it('announces a message once, however often it re-renders', async () => {
    const messages = [toast('a', 'Page added')];
    const {rerender} = render(<ToastRegion toasts={messages} onDismiss={vi.fn()} />);

    await advance(0);
    rerender(<ToastRegion toasts={messages} onDismiss={vi.fn()} />);
    await advance(TOAST_ANNOUNCEMENT_GAP_MS * 3);

    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('can announce the same sentence again after the first has cleared', async () => {
    // The live region ignores an identical consecutive value, so the region
    // has to return to empty between messages or a repeat is never read.
    const {rerender} = render(<ToastRegion toasts={[toast('a', 'Could not pause')]} onDismiss={vi.fn()} />);

    await advance(TOAST_ANNOUNCEMENT_GAP_MS * 2);
    expect(screen.getByRole('status')).toHaveTextContent('');

    rerender(<ToastRegion toasts={[toast('b', 'Could not pause')]} onDismiss={vi.fn()} />);
    await advance(0);

    expect(screen.getByRole('status')).toHaveTextContent('Could not pause');
  });
});
