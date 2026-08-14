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
    const {container} = render(<AuditProgress phase={PHASES[1]?.label ?? null} />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('keeps every phase pending before running begins', () => {
    render(<AuditProgress phase={null} />);

    for (const step of PHASES) {
      expect(stateOf(step.label)).toBe('pending');
    }
    expect(screen.getByText('0/3 steps')).toBeInTheDocument();
  });

  it.each([
    {phaseIndex: 0, states: ['active', 'pending', 'pending'], progress: '0/3 steps', fill: '0%'},
    {phaseIndex: 1, states: ['done', 'active', 'pending'], progress: '1/3 steps', fill: '33.33333333333333%'},
    {phaseIndex: 2, states: ['done', 'done', 'active'], progress: '2/3 steps', fill: '66.66666666666666%'},
  ])('renders phase $phaseIndex as active with the matching progress', ({phaseIndex, states, progress, fill}) => {
    const {container} = render(<AuditProgress phase={PHASES[phaseIndex]?.label ?? null} />);

    expect(PHASES.map((step) => stateOf(step.label))).toEqual(states);
    expect(document.querySelector('.audit-progress__spinner')).toBeInTheDocument();
    expect(screen.getByText(progress)).toBeInTheDocument();
    expect(container.querySelector('.audit-progress__fill')).toHaveStyle({inlineSize: fill});
  });

  it('checks every phase and fills the bar after presentation completion', () => {
    const {container} = render(<AuditProgress phase={null} complete />);

    for (const step of PHASES) {
      expect(stateOf(step.label)).toBe('done');
    }
    expect(container.querySelector('.audit-progress__fill')).toHaveStyle({inlineSize: '100%'});
    expect(screen.getByText('3/3 steps')).toBeInTheDocument();
  });

  it('names the real engine without inventing versions', () => {
    render(<AuditProgress phase={null} />);

    expect(screen.getByText('axe-core · Chromium')).toBeInTheDocument();
  });

  it('draws one step per phase the app actually infers', () => {
    // Not the six the mock invented: this panel may not claim more resolution
    // than `phaseFor` has.
    render(<AuditProgress phase={PHASES[0]?.label ?? null} />);

    expect(screen.getAllByText(/./, {selector: '.audit-progress__step'})).toHaveLength(PHASES.length);
  });
});
