// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {pollAfterMsFrom, shareUrlFor, startedHere, startedHereFrom} from './share';

describe('shareUrlFor', () => {
  it('builds the public result address for an audit', () => {
    expect(shareUrlFor('3f2b', 'https://tabstop.test')).toBe('https://tabstop.test/r/3f2b');
  });

  it('answers with a canonical link, not whatever the reader happens to be looking at', () => {
    // A share page reached with a tracking parameter must not hand that
    // parameter to the next person.
    expect(shareUrlFor('3f2b', 'https://tabstop.test/r/3f2b?utm_source=slack#top')).toBe('https://tabstop.test/r/3f2b');
  });

  it('keeps a non-standard port, which is how this runs in development', () => {
    expect(shareUrlFor('3f2b', 'http://localhost:5173')).toBe('http://localhost:5173/r/3f2b');
  });

  it('escapes the id rather than pasting it into a path', () => {
    // The id reaches this from a route parameter, so it is not ours to trust.
    expect(shareUrlFor('a/../b', 'https://tabstop.test')).toBe('https://tabstop.test/r/a%2F..%2Fb');
  });
});

describe('telling the owner of an audit from a stranger', () => {
  it('recognises the marker the landing attaches', () => {
    // The two halves are written apart - one navigates, one reads - so a
    // renamed key would be a silent no-op rather than a failure.
    expect(startedHereFrom(startedHere())).toBe(true);
  });

  it('reads every other arrival as someone who followed a link', () => {
    // A pasted link is a fresh navigation and carries no state, which is the
    // whole mechanism: absence is the signal.
    for (const state of [null, undefined, {}, {from: '/dashboard'}]) {
      expect(startedHereFrom(state)).toBe(false);
    }
  });

  it('is not satisfied by a value that merely looks truthy', () => {
    for (const state of [{startedHere: 'yes'}, {startedHere: 1}, {startedHere: false}]) {
      expect(startedHereFrom(state)).toBe(false);
    }
  });
});

describe('the poll interval carried with a new audit', () => {
  it('survives the trip, so the server can still widen it', () => {
    expect(pollAfterMsFrom(startedHere(5000))).toBe(5000);
  });

  it('is absent on a link someone opened cold, which falls back', () => {
    for (const state of [null, undefined, {}, startedHere()]) {
      expect(pollAfterMsFrom(state)).toBeUndefined();
    }
  });

  it('refuses a value that would poll wrongly or not at all', () => {
    for (const state of [{pollAfterMs: 0}, {pollAfterMs: -1}, {pollAfterMs: '2000'}, {pollAfterMs: Number.NaN}]) {
      expect(pollAfterMsFrom(state)).toBeUndefined();
    }
  });
});
