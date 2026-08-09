import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router';
import {describe, expect, it} from 'vitest';
import {AuthShell} from './index';

describe('AuthShell', () => {
  it('presents the auth content with navigation back home', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthShell title="Welcome back" subtitle="Sign in to continue" footer={<a href="/signup">Create an account</a>}>
          <form aria-label="Sign in form" />
        </AuthShell>
      </MemoryRouter>,
    );

    const headings = screen.getAllByRole('heading', {level: 1});
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveAccessibleName('Welcome back');
    expect(screen.getByText('Sign in to continue')).toBeVisible();
    expect(screen.getByRole('form', {name: 'Sign in form'})).toBeVisible();

    expect(screen.getByRole('link', {name: /tabstop/i})).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', {name: 'Create an account'})).toHaveAttribute('href', '/signup');
  });
});
