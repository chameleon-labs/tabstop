import {describe, expect, it} from 'vitest';
import {EXPECTED_DURATION, PHASES, announcementFor, completionAnnouncement, phaseFor} from './phase';

describe('phaseFor', () => {
  it('does not claim a queue place before the request is accepted', () => {
    expect(phaseFor('submitting', 0)).toBe('Requesting the audit');
    expect(phaseFor('submitting', 30_000)).toBe('Requesting the audit');
  });

  it('says a queued audit is queued, rather than claiming to be fetching', () => {
    expect(phaseFor('queued', 0)).toBe('Waiting for a free worker');
    expect(phaseFor('queued', 30_000)).toBe('Waiting for a free worker');
  });

  it('walks the phases in order as time passes', () => {
    expect(phaseFor('running', 0)).toBe('Fetching the page');
    expect(phaseFor('running', 7_999)).toBe('Fetching the page');
    expect(phaseFor('running', 8_000)).toBe('Running the accessibility engine');
    expect(phaseFor('running', 19_999)).toBe('Running the accessibility engine');
    expect(phaseFor('running', 20_000)).toBe('Scoring');
  });

  it('stays on the last phase when an audit overruns', () => {
    expect(phaseFor('running', 120_000)).toBe('Scoring');
  });

  it('never goes backwards', () => {
    const seen = Array.from({length: 200}, (_, i) => phaseFor('running', i * 250));
    const order = PHASES.map((phase) => phase.label);

    let highest = 0;
    for (const label of seen) {
      const index = order.indexOf(label ?? '');
      expect(index).toBeGreaterThanOrEqual(highest);
      highest = index;
    }
  });

  it('has nothing to say once the audit is over', () => {
    expect(phaseFor('done', 30_000)).toBeNull();
    expect(phaseFor('failed', 30_000)).toBeNull();
  });
});

describe('announcementFor', () => {
  it('sets the expectation up front, because thirty seconds is a long time', () => {
    expect(announcementFor('Fetching the page', null)).toBe(`Fetching the page… ${EXPECTED_DURATION}`);
  });

  it('says nothing when the phase has not changed', () => {
    expect(announcementFor('Fetching the page', 'Fetching the page')).toBeNull();
  });

  it('speaks again when the phase actually changes', () => {
    expect(announcementFor('Scoring', 'Running the accessibility engine')).toBe(`Scoring… ${EXPECTED_DURATION}`);
  });

  it('says nothing when there is no phase', () => {
    expect(announcementFor(null, 'Scoring')).toBeNull();
    expect(announcementFor(null, null)).toBeNull();
  });

  it('announces three times across a whole audit, not once per poll', () => {
    let announced: string | null = null;
    const spoken: string[] = [];

    for (let elapsed = 0; elapsed <= 30_000; elapsed += 2_000) {
      const phase = phaseFor('running', elapsed);
      const next = announcementFor(phase, announced);
      if (next !== null) {
        spoken.push(next);
        announced = phase;
      }
    }

    expect(spoken).toEqual([
      `Fetching the page… ${EXPECTED_DURATION}`,
      `Running the accessibility engine… ${EXPECTED_DURATION}`,
      `Scoring… ${EXPECTED_DURATION}`,
    ]);
  });
});

describe('completionAnnouncement', () => {
  it('says the wait is over, and roughly what was found', () => {
    expect(completionAnnouncement(72, 3)).toBe('Audit complete. Score 72. 3 issues found.');
  });

  it('counts one issue as one', () => {
    expect(completionAnnouncement(90, 1)).toBe('Audit complete. Score 90. 1 issue found.');
  });

  it('says nothing about a score there is not', () => {
    expect(completionAnnouncement(null, 0)).toBe('Audit complete. 0 issues found.');
  });

  it('does not recite the findings', () => {
    expect(completionAnnouncement(72, 40).length).toBeLessThan(60);
  });
});
