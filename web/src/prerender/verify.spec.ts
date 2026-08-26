import {describe, expect, it} from 'vitest';
import type {PrerenderedPage} from './paths';
import {assertBuildOutput, type PrerenderedOutput} from './verify';

const APP_SHELL = '<div id="root"><div class="route-skeleton" data-shape="generic"></div></div>';

const stampedIndex = '<div id="root" data-prerendered="/">hello</div>';

const scoreFormula: PrerenderedPage = {
  path: '/docs/score-formula',
  title: 'Score formula · tabstop',
  description: 'How a score is calculated.',
  entry: 'src/screens/modules/docs/pages/ScoreFormula/index.tsx',
};

const wholeDocument = (overrides: Partial<{title: string; description: string; stylesheet: string}> = {}): string => {
  const {
    title = 'Score formula · tabstop',
    description = 'How a score is calculated.',
    stylesheet = '/assets/ScoreFormula-def.css',
  } = overrides;

  return (
    `<!doctype html><html><head><title>${title}</title>` +
    `<meta name="description" content="${description}" />` +
    `<link rel="stylesheet" crossorigin href="${stylesheet}"></head>` +
    '<body><div id="root" data-prerendered="/docs/score-formula"></div></body></html>'
  );
};

const writtenFormula = (overrides: Partial<PrerenderedOutput> = {}): PrerenderedOutput => ({
  page: scoreFormula,
  exists: true,
  html: wholeDocument(),
  stylesheets: ['/assets/ScoreFormula-def.css'],
  ...overrides,
});

describe('assertBuildOutput', () => {
  it('passes when app.html was written and index.html carries the stamp', () => {
    expect(() => assertBuildOutput(APP_SHELL, stampedIndex)).not.toThrow();
  });

  it('throws when app.html was not written', () => {
    // `_redirects` routes every non-prerendered path there; missing it is a
    // build that looks green and 404s every route but `/` on the host.
    expect(() => assertBuildOutput('', stampedIndex)).toThrow(/app\.html/);
  });

  it('throws when the app shell would paint nothing before its bundle arrives', () => {
    expect(() => assertBuildOutput('<div id="root"></div>', stampedIndex)).toThrow(/skeleton/);
  });

  it('throws when index.html has no data-prerendered stamp', () => {
    expect(() => assertBuildOutput(APP_SHELL, '<div id="root"></div>')).toThrow(/data-prerendered/);
  });

  it('passes a complete score formula artifact', () => {
    expect(() => assertBuildOutput(APP_SHELL, stampedIndex, [writtenFormula()])).not.toThrow();
  });

  it('throws when the score formula artifact was not written', () => {
    expect(() => assertBuildOutput(APP_SHELL, stampedIndex, [writtenFormula({exists: false, html: ''})])).toThrow(
      /docs\/score-formula/,
    );
  });

  it('throws when the score formula artifact carries another path stamp', () => {
    expect(() =>
      assertBuildOutput(APP_SHELL, stampedIndex, [
        writtenFormula({html: '<div id="root" data-prerendered="/"></div>'}),
      ]),
    ).toThrow('data-prerendered="/docs/score-formula"');
  });

  it('throws when the artifact kept the template title', () => {
    // The whole file is checked, not only the rendered body: a page that
    // publishes the landing page's title renders perfectly and is still wrong.
    expect(() =>
      assertBuildOutput(APP_SHELL, stampedIndex, [writtenFormula({html: wholeDocument({title: 'tabstop'})})]),
    ).toThrow(/title/i);
  });

  it('throws when the artifact kept the template description', () => {
    expect(() =>
      assertBuildOutput(APP_SHELL, stampedIndex, [
        writtenFormula({html: wholeDocument({description: 'Paste a URL, get an accessibility audit and a score.'})}),
      ]),
    ).toThrow(/description/i);
  });

  it('throws when a route stylesheet is missing from the artifact', () => {
    // Without it the page paints unstyled until the route chunk downloads.
    expect(() =>
      assertBuildOutput(APP_SHELL, stampedIndex, [
        writtenFormula({html: wholeDocument({stylesheet: '/assets/other.css'})}),
      ]),
    ).toThrow('/assets/ScoreFormula-def.css');
  });

  it('throws when a page with a route chunk resolved no stylesheets at all', () => {
    // An entry that no longer matches a manifest key resolves to nothing, and
    // an empty list would otherwise assert nothing and pass.
    expect(() => assertBuildOutput(APP_SHELL, stampedIndex, [writtenFormula({stylesheets: []})])).toThrow(
      scoreFormula.entry!,
    );
  });
});
