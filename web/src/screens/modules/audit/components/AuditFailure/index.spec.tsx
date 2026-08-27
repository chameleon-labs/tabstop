import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it, vi} from 'vitest';
import {AuditFailure} from './index';
import type {DescribedFailure} from '../../failure';
import {Providers} from '@/test/render';

const show = (failure: DescribedFailure): {onRetry: ReturnType<typeof vi.fn>} => {
  const onRetry = vi.fn();
  render(
    <Providers>
      <AuditFailure failure={failure} onRetry={onRetry} />
    </Providers>,
  );
  return {onRetry};
};

describe('AuditFailure', () => {
  it('shows the sentence the server wrote, rather than one of its own', () => {
    show({message: 'Could not resolve that domain', action: 'retry', source: 'audit'});

    expect(screen.getByText('Could not resolve that domain')).toBeVisible();
  });

  describe('the heading names what actually failed', () => {
    it('does not say an audit did not finish when none was started', () => {
      show({message: "That address can't be audited", action: 'check-url', source: 'request'});

      expect(screen.getByRole('heading', {level: 2})).toHaveTextContent('That audit could not be started');
    });

    it('does not claim a running audit failed when only the poll did', () => {
      show({message: 'Internal server error', action: 'retry', source: 'poll'});

      expect(screen.getByRole('heading', {level: 2})).toHaveTextContent('Lost track of that audit');
    });

    it('says an audit did not finish only when one actually did not', () => {
      show({message: 'The page took too long to load', action: 'retry', source: 'audit'});

      expect(screen.getByRole('heading', {level: 2})).toHaveTextContent('That audit did not finish');
    });
  });

  it('interrupts, because it replaces something being waited on', () => {
    show({message: 'boom', action: 'retry', source: 'audit'});

    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  describe('retry', () => {
    it('offers a button that re-runs the same URL', async () => {
      const {onRetry} = show({message: 'The page took too long to load', action: 'retry', source: 'audit'});

      await userEvent.click(screen.getByRole('button', {name: 'Try again'}));

      expect(onRetry).toHaveBeenCalledOnce();
    });

    it('offers no button when the caller has nothing to retry', () => {
      render(
        <Providers>
          <AuditFailure failure={{message: 'The page took too long to load', action: 'retry', source: 'audit'}} />
        </Providers>,
      );

      expect(screen.getByText('The page took too long to load')).toBeVisible();
      expect(screen.queryByRole('button', {name: 'Try again'})).not.toBeInTheDocument();
    });
  });

  describe('check-url', () => {
    it('does not offer a retry that is guaranteed to fail identically', () => {
      show({message: "That address can't be audited", action: 'check-url', source: 'request'});

      expect(screen.queryByRole('button', {name: 'Try again'})).not.toBeInTheDocument();
      expect(screen.getByText(/Check the address/)).toBeVisible();
    });
  });

  describe('the rate limit, which is not an error', () => {
    const limited: DescribedFailure = {
      message: 'Too many requests',
      action: 'signup',
      source: 'request',
      rateLimit: {error: 'Too many requests', retryAfter: 45, resetAt: '2026-08-03T10:00:00Z'},
    };

    it('reads as an offer rather than a failure', () => {
      show(limited);

      expect(screen.getByRole('heading', {level: 2})).toHaveTextContent('You have used your free audits');
      expect(screen.getByRole('link', {name: 'Create an account'})).toBeVisible();
    });

    it('still says how long the wait is', () => {
      show(limited);

      expect(screen.getByText(/wait 45 seconds/)).toBeVisible();
    });

    it('omits the wait when the server did not give a usable one', () => {
      show({message: 'Too many requests', action: 'signup', source: 'request'});

      expect(screen.queryByText(/wait/)).not.toBeInTheDocument();
      expect(screen.getByRole('link', {name: 'Create an account'})).toBeVisible();
    });
  });

  describe('none', () => {
    it('offers nothing rather than inventing an affordance', () => {
      show({message: 'Forbidden', action: 'none', source: 'request'});

      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('Forbidden')).toBeVisible();
    });
  });
});
