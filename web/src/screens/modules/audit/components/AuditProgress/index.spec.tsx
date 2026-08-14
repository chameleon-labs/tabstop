import {render, screen} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {PHASES} from '../../phase';
import {AuditProgress} from './index';

const stateOf = (label: string): string | null =>
  screen.getByText(label).closest('li')?.getAttribute('data-state') ?? null;

describe('AuditProgress', () => {
  it('says nothing to a screen reader, because the status line already does', () => {
    // Every word here restates the live region beside it. Two copies means the
    // reader hears each phase twice, three times over one audit.
    const {container} = render(<AuditProgress status="running" phase={PHASES[1]?.label ?? null} />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('marks the phases behind the current one as done, and the ones ahead as pending', () => {
    render(<AuditProgress status="running" phase={PHASES[1]?.label ?? null} />);

    expect(stateOf(PHASES[0]?.label ?? '')).toBe('done');
    expect(stateOf(PHASES[1]?.label ?? '')).toBe('active');
    expect(stateOf(PHASES[2]?.label ?? '')).toBe('pending');
  });

  it('claims nothing has run while the audit is still queued', () => {
    // Nothing is being fetched yet, and a log that says otherwise is the kind
    // of small lie that makes a progress indicator untrustworthy.
    render(<AuditProgress status="queued" phase="Waiting for a free worker" />);

    for (const step of PHASES) {
      expect(stateOf(step.label)).toBe('pending');
    }
    expect(screen.getByText('0/3 steps')).toBeInTheDocument();
  });

  it('fills the bar in step with the phases, rather than on a timer of its own', () => {
    const {container} = render(<AuditProgress status="running" phase={PHASES[2]?.label ?? null} />);

    expect(container.querySelector('.audit-progress__fill')).toHaveStyle({inlineSize: '66.66666666666666%'});
    expect(screen.getByText('2/3 steps')).toBeInTheDocument();
  });

  it('draws one step per phase the app actually infers', () => {
    // Not the six the mock invented: this panel may not claim more resolution
    // than `phaseFor` has.
    render(<AuditProgress status="running" phase={PHASES[0]?.label ?? null} />);

    expect(screen.getAllByText(/./, {selector: '.audit-progress__step'})).toHaveLength(PHASES.length);
  });
});
