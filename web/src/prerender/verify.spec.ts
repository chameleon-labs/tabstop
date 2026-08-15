import {describe, expect, it} from 'vitest';
import {assertBuildOutput} from './verify';

const stampedIndex = '<div id="root" data-prerendered="/">hello</div>';
const scoreFormulaPath = '/docs/score-formula';

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

  it('throws when the score formula artifact was not written', () => {
    expect(() => assertBuildOutput(true, stampedIndex, [{path: scoreFormulaPath, exists: false, html: ''}])).toThrow(
      /docs\/score-formula/,
    );
  });

  it('throws when the score formula artifact carries another path stamp', () => {
    expect(() =>
      assertBuildOutput(true, stampedIndex, [
        {path: scoreFormulaPath, exists: true, html: '<div id="root" data-prerendered="/"></div>'},
      ]),
    ).toThrow('data-prerendered="/docs/score-formula"');
  });
});
