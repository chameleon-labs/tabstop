import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {CopyLink} from './index';

const URL = 'https://tabstop.test/r/3f2b';

/** Absent in jsdom, and absent in a real browser outside a secure context. */
const withClipboard = (writeText: () => Promise<void>): void => {
  Object.defineProperty(navigator, 'clipboard', {value: {writeText}, configurable: true});
};

const withoutClipboard = (): void => {
  Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true});
};

const press = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', {name: 'Copy link'}));
};

afterEach(() => {
  withoutClipboard();
});

describe('CopyLink', () => {
  it('puts the given link on the clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    withClipboard(writeText);
    render(<CopyLink url={URL} />);

    await press();

    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it('confirms into a region that was already mounted and empty', async () => {
    // Content present when a region first appears is initial content, and
    // assistive technology says nothing about it. See `AuditStatus`.
    withClipboard(() => Promise.resolve());
    render(<CopyLink url={URL} />);

    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();

    await press();

    expect(region).toHaveTextContent('Link copied');
  });

  it('keeps the button named the same, so the control just pressed does not rename itself', async () => {
    withClipboard(() => Promise.resolve());
    render(<CopyLink url={URL} />);

    await press();

    expect(screen.getByRole('button', {name: 'Copy link'})).toBeVisible();
  });

  it('says so and shows the link when the clipboard refuses', async () => {
    // Denied permission. A button that silently does nothing is worse than one
    // that admits it failed.
    withClipboard(() => Promise.reject(new DOMException('Write permission denied', 'NotAllowedError')));
    render(<CopyLink url={URL} />);

    await press();

    expect(screen.getByRole('status')).toHaveTextContent('Could not copy the link');
    expect(screen.getByText(URL)).toBeVisible();
  });

  it('says so when there is no clipboard at all', async () => {
    // Any page served over plain http, which includes a colleague opening this
    // on a local network address.
    withoutClipboard();
    render(<CopyLink url={URL} />);

    await press();

    expect(screen.getByRole('status')).toHaveTextContent('Could not copy the link');
  });

  it('shows nothing to copy by hand until copying has actually failed', async () => {
    withClipboard(() => Promise.resolve());
    render(<CopyLink url={URL} />);

    expect(screen.queryByText(URL)).not.toBeInTheDocument();

    await press();

    expect(screen.queryByText(URL)).not.toBeInTheDocument();
  });
});
