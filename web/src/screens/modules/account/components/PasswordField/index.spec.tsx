import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {PasswordField} from './index';

describe('PasswordField', () => {
  it('reveals and hides the password with an accessible action', async () => {
    const user = userEvent.setup();
    render(<PasswordField label="Password" />);

    const input = screen.getByLabelText('Password');
    const show = screen.getByRole('button', {name: 'Show password'});
    expect(input).toHaveAttribute('type', 'password');
    expect(show).toHaveClass('lat-addon-button');
    expect(show).not.toHaveClass('lat-button');
    expect(show).toHaveAttribute('type', 'button');
    expect(show).toHaveAttribute('data-size', 'md');
    expect(show.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    await user.click(show);

    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', {name: 'Hide password'})).toBeVisible();

    await user.click(screen.getByRole('button', {name: 'Hide password'}));

    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', {name: 'Show password'})).toBeVisible();
  });

  it('preserves Lattice label and error relationships', () => {
    render(<PasswordField label="Account password" error="Password is required" />);

    const input = screen.getByLabelText('Account password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Password is required');
  });

  it('disables the input and keeps the unavailable reveal action discoverable', async () => {
    const user = userEvent.setup();
    render(<PasswordField label="Password" disabled />);

    const input = screen.getByLabelText('Password');
    const reveal = screen.getByRole('button', {name: 'Show password'});
    expect(input).toBeDisabled();
    expect(reveal).toHaveAttribute('aria-disabled', 'true');
    expect(reveal).not.toHaveAttribute('disabled');

    await user.click(reveal);

    expect(input).toHaveAttribute('type', 'password');
  });
});
