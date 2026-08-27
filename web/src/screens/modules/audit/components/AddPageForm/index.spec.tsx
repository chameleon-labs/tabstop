import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {URL_PROBLEMS} from '../../url';
import {AddPageForm, type AddPageFormProps} from './index';

const deferred = <T,>(): {promise: Promise<T>; resolve: (value: T) => void} => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return {promise, resolve};
};

const renderForm = (overrides: Partial<AddPageFormProps> = {}) => {
  const onSubmit = vi.fn(async () => await Promise.resolve(true));
  const props: AddPageFormProps = {mode: 'compact', used: 2, limit: 10, onSubmit, ...overrides};

  return {onSubmit: props.onSubmit, ...render(<AddPageForm {...props} />)};
};

const field = (): HTMLElement => screen.getByLabelText('Page URL');
const addButton = (): HTMLElement => screen.getByRole('button', {name: /Add page|Adding page/});

describe('AddPageForm', () => {
  it('submits the canonical url rather than what was typed', async () => {
    const user = userEvent.setup();
    const {onSubmit} = renderForm();

    await user.type(field(), 'example.com');
    await user.click(addButton());

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('https://example.com/');
  });

  it('says nothing about an empty field before it has been submitted', () => {
    renderForm();

    expect(screen.queryByText(URL_PROBLEMS.empty)).not.toBeInTheDocument();
    expect(field()).not.toHaveAttribute('aria-invalid');
  });

  it('explains an unusable url and keeps the request to itself', async () => {
    const user = userEvent.setup();
    const {onSubmit} = renderForm();

    await user.type(field(), 'not a url');
    await user.click(addButton());

    expect(screen.getByText(URL_PROBLEMS.unparseable)).toBeVisible();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(field()).toHaveAccessibleDescription(URL_PROBLEMS.unparseable);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('puts the cursor back where the problem is', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(addButton());

    expect(screen.getByText(URL_PROBLEMS.empty)).toBeVisible();
    expect(field()).toHaveFocus();
  });

  it('clears the complaint as soon as the url becomes usable', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(addButton());
    expect(screen.getByText(URL_PROBLEMS.empty)).toBeVisible();

    await user.type(field(), 'example.com');

    expect(screen.queryByText(URL_PROBLEMS.empty)).not.toBeInTheDocument();
    expect(field()).not.toHaveAttribute('aria-invalid');
  });

  it('shuts the form while the request is in flight', async () => {
    const user = userEvent.setup();
    const pending = deferred<boolean>();
    renderForm({onSubmit: vi.fn(async () => await pending.promise)});

    await user.type(field(), 'example.com');
    await user.click(addButton());

    expect(screen.getByRole('button', {name: 'Adding page…'})).toBeDisabled();
    expect(field()).toBeDisabled();

    pending.resolve(true);
    await waitFor(() => {
      expect(screen.getByRole('button', {name: 'Add page'})).toBeEnabled();
    });
  });

  it('empties itself only once the page has actually been added', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(field(), 'example.com');
    await user.click(addButton());

    await waitFor(() => {
      expect(field()).toHaveValue('');
    });
    expect(field()).not.toHaveAttribute('aria-invalid');
  });

  it('keeps what was typed when the request is refused', async () => {
    const user = userEvent.setup();
    renderForm({onSubmit: vi.fn(async () => await Promise.resolve(false))});

    await user.type(field(), 'example.com');
    await user.click(addButton());

    await waitFor(() => {
      expect(screen.getByRole('button', {name: 'Add page'})).toBeEnabled();
    });
    expect(field()).toHaveValue('example.com');
  });

  it('refuses to submit twice while the first request is running', async () => {
    const user = userEvent.setup();
    const pending = deferred<boolean>();
    const onSubmit = vi.fn(async () => await pending.promise);
    const {container} = renderForm({onSubmit});
    const form = container.querySelector('form')!;

    await user.type(field(), 'example.com');
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.submit(form);
      await Promise.resolve();
    });

    expect(screen.getByRole('button', {name: 'Adding page…'})).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(true);
      await Promise.resolve();
    });
  });

  describe('at the page limit', () => {
    it('closes the form and says what to do about it', () => {
      const {onSubmit, container} = renderForm({used: 10, limit: 10});

      expect(field()).toBeDisabled();
      expect(addButton()).toBeDisabled();
      expect(screen.getByText('You are monitoring 10 of 10 pages. Remove a page before adding another.')).toBeVisible();
      expect(field()).toHaveAccessibleDescription(
        'You are monitoring 10 of 10 pages. Remove a page before adding another.',
      );

      fireEvent.submit(container.querySelector('form')!);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('opens again as soon as there is room', () => {
      const {rerender} = render(<AddPageForm mode="compact" used={10} limit={10} onSubmit={vi.fn()} />);
      expect(field()).toBeDisabled();

      rerender(<AddPageForm mode="compact" used={9} limit={10} onSubmit={vi.fn()} />);

      expect(field()).toBeEnabled();
      expect(screen.queryByText(/Remove a page before adding another/)).not.toBeInTheDocument();
    });
  });

  describe('across both compositions', () => {
    it.each([{mode: 'empty' as const}, {mode: 'compact' as const}])(
      'validates identically in %s mode',
      async ({mode}) => {
        const user = userEvent.setup();
        const {onSubmit} = renderForm({mode});

        await user.type(field(), 'not a url');
        await user.click(addButton());

        expect(screen.getByText(URL_PROBLEMS.unparseable)).toBeVisible();
        expect(onSubmit).not.toHaveBeenCalled();
      },
    );

    it('marks which composition it is rendering', () => {
      const {container} = render(<AddPageForm mode="empty" used={0} limit={10} onSubmit={vi.fn()} />);

      expect(container.querySelector('.add-page-form')).toHaveAttribute('data-mode', 'empty');
    });
  });

  it('lets the screen own the field, so focus can be moved to it after a removal', () => {
    const inputRef = {current: null} as React.RefObject<HTMLInputElement | null>;
    render(<AddPageForm mode="empty" used={0} limit={10} inputRef={inputRef} onSubmit={vi.fn()} />);

    expect(inputRef.current).toBe(field());
  });
});
