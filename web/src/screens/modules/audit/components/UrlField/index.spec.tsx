import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {UrlField} from './index';

const setup = (): {onSubmit: ReturnType<typeof vi.fn>} => {
  const onSubmit = vi.fn();
  render(<UrlField onSubmit={onSubmit} />);
  return {onSubmit};
};

const field = (): HTMLElement => screen.getByLabelText('Page to audit');

describe('UrlField', () => {
  it('submits the canonical URL, not what was typed', async () => {
    const {onSubmit} = setup();

    await userEvent.type(field(), 'example.com');
    await userEvent.click(screen.getByRole('button', {name: 'Audit this page'}));

    expect(onSubmit).toHaveBeenCalledWith('https://example.com/');
  });

  it('submits on Enter, not only on the button', async () => {
    const {onSubmit} = setup();

    await userEvent.type(field(), 'example.com{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('https://example.com/');
  });

  describe('when validation happens', () => {
    it('says nothing while someone is still typing', async () => {
      setup();

      await userEvent.type(field(), 'e');

      expect(screen.queryByText('That does not look like a URL')).not.toBeInTheDocument();
      expect(field()).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('answers once they have asked, by submitting', async () => {
      const {onSubmit} = setup();

      await userEvent.type(field(), 'mailto:someone@example.com{Enter}');

      expect(await screen.findByText('That does not look like a URL')).toBeVisible();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('refuses an empty submission with its own message', async () => {
      const {onSubmit} = setup();

      await userEvent.click(screen.getByRole('button', {name: 'Audit this page'}));

      expect(await screen.findByText('Enter a URL to audit')).toBeVisible();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('keeps checking as they fix it, once it has spoken', async () => {
      const {onSubmit} = setup();
      await userEvent.click(screen.getByRole('button', {name: 'Audit this page'}));
      await screen.findByText('Enter a URL to audit');

      await userEvent.type(field(), 'example.com');

      expect(screen.queryByText('Enter a URL to audit')).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', {name: 'Audit this page'}));
      expect(onSubmit).toHaveBeenCalledWith('https://example.com/');
    });
  });

  describe('the parts a screen reader depends on', () => {
    it('marks the field invalid, rather than only colouring it', async () => {
      setup();

      await userEvent.type(field(), '{Enter}');

      expect(field()).toHaveAttribute('aria-invalid', 'true');
    });

    it('ties the message to the field, so it is read on focus', async () => {
      setup();
      await userEvent.type(field(), 'mailto:x{Enter}');

      const describedBy = field().getAttribute('aria-describedby') ?? '';
      const ids = describedBy.split(' ').filter((id) => id !== '');

      expect(ids.length).toBeGreaterThan(0);
      expect(ids.map((id) => document.getElementById(id)?.textContent).join(' ')).toContain(
        'That does not look like a URL',
      );
    });

    it('announces the message, since it appears in response to a keypress', async () => {
      setup();

      await userEvent.type(field(), '{Enter}');

      expect(screen.getByRole('alert')).toHaveTextContent('Enter a URL to audit');
    });

    it('accepts a bare domain, which type="url" would have rejected first', async () => {
      const {onSubmit} = setup();

      await userEvent.type(field(), 'example.com{Enter}');

      expect(field()).toHaveAttribute('type', 'text');
      expect(onSubmit).toHaveBeenCalled();
    });
  });

  it('cannot be submitted twice while an audit is running', () => {
    const onSubmit = vi.fn();
    render(<UrlField onSubmit={onSubmit} disabled />);

    expect(screen.getByRole('button', {name: 'Requesting…'})).toBeDisabled();
    expect(field()).toBeDisabled();
  });
});
