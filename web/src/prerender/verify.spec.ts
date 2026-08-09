import {describe, expect, it} from 'vitest';
import {assertBuildOutput} from './verify';

const stampedIndex = '<div id="root" data-prerendered="/">hello</div>';

describe('assertBuildOutput', () => {
  it('passes when app.html was written and index.html carries the stamp', () => {
    expect(() => assertBuildOutput(true, stampedIndex)).not.toThrow();
  });

  it('throws when app.html was not written', () => {
    // `_redirects` routes every non-prerendered path there; missing it is a
    // build that looks green and 404s every route but `/` on the host.
    expect(() => assertBuildOutput(false, stampedIndex)).toThrow(/app\.html/);
  });

  it('throws when index.html has no data-prerendered stamp', () => {
    expect(() => assertBuildOutput(true, '<div id="root"></div>')).toThrow(/data-prerendered/);
  });
});
