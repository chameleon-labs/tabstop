/* oxlint-disable vitest/expect-expect -- the `it.fails` tests assert by failing: the gate's verdict is the assertion. */
import {render, screen} from '@testing-library/react';
import {Component, useEffect, type ReactNode} from 'react';
import {describe, expect, it} from 'vitest';
import {ApiError} from './api/client';

describe('the console gate', () => {
  it.fails('fails a test that writes to console.error', () => {
    console.error('a stray error');
  });

  it.fails('fails a test that writes to console.warn', () => {
    console.warn('a stray warning');
  });

  it.fails('fails a test whose component logs while UNMOUNTING', () => {
    const LogsOnUnmount = (): React.JSX.Element => {
      useEffect(
        () => () => {
          console.warn('logged while unmounting');
        },
        [],
      );
      return <p>mounted</p>;
    };

    render(<LogsOnUnmount />);
  });

  it('lets an error a boundary CATCHES through, since specs cause those on purpose', () => {
    const Boom = (): React.JSX.Element => {
      throw new ApiError(404, 'Not found', null);
    };

    render(
      <Boundary>
        <Boom />
      </Boundary>,
    );

    expect(screen.getByText('caught it')).toBeVisible();
  });
});

class Boundary extends Component<{children: ReactNode}, {failed: boolean}> {
  override state = {failed: false};

  static getDerivedStateFromError(): {failed: boolean} {
    return {failed: true};
  }

  override render(): ReactNode {
    return this.state.failed ? <p>caught it</p> : this.props.children;
  }
}
