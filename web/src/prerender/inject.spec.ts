import {describe, expect, it} from 'vitest';
import {injectMarkup} from './inject';
import type {PrerenderedPage} from './paths';

const template =
  '<!doctype html><html><head><title>tabstop</title>' +
  '<meta name="description" content="Paste a URL, get an accessibility audit and a score." />' +
  '<link rel="stylesheet" crossorigin href="/assets/index-abc.css"></head>' +
  '<body><div id="root"></div></body></html>';

const landing: PrerenderedPage = {path: '/'};
const docs: PrerenderedPage = {
  path: '/docs/score-formula',
  title: 'Score formula · tabstop',
  description: 'How a score is calculated.',
  entry: 'src/screens/modules/docs/pages/ScoreFormula/index.tsx',
};

describe('injectMarkup', () => {
  it('preserves replacement patterns in the rendered markup', () => {
    // Dollar signs and ampersands are common in rendered content (prices, entities).
    // String.replace() with a string argument interprets $& and $$ as replacement
    // patterns, which silently corrupts the output. This test ensures they are
    // preserved literally.
    const htmlWithPatterns = '<p>Price: $& off, $$ special</p>';
    const result = injectMarkup(template, landing, htmlWithPatterns);
    expect(result).toContain('Price: $& off, $$ special');
  });

  it('fills the root element with the rendered markup', () => {
    expect(injectMarkup(template, landing, '<p>hello</p>')).toContain('<p>hello</p>');
  });

  it('stamps the path that was rendered, so the client can check it', () => {
    expect(injectMarkup(template, landing, '<p>hello</p>')).toContain('data-prerendered="/"');
  });

  it('leaves the rest of the document alone', () => {
    const result = injectMarkup(template, landing, '<p>hello</p>');

    expect(result.startsWith('<!doctype html><html><head>')).toBe(true);
    expect(result.endsWith('</body></html>')).toBe(true);
  });

  it('keeps the template head for a page that declares no metadata of its own', () => {
    const result = injectMarkup(template, landing, '<p>hello</p>');

    expect(result).toContain('<title>tabstop</title>');
    expect(result).toContain('content="Paste a URL, get an accessibility audit and a score."');
  });

  it('publishes the page’s own title and description', () => {
    // The template's head is the landing page's. Crawlers and no-JavaScript
    // visits never run `useDocumentTitle`, so whatever is written here is the
    // only metadata this URL ever has.
    const result = injectMarkup(template, docs, '<p>hello</p>');

    expect(result).toContain('<title>Score formula · tabstop</title>');
    expect(result).toContain('content="How a score is calculated."');
    expect(result).not.toContain('<title>tabstop</title>');
    expect(result).not.toContain('Paste a URL, get an accessibility audit and a score.');
  });

  it('escapes the metadata it writes into an attribute', () => {
    const result = injectMarkup(template, {...docs, description: 'Quotes "like" this & that'}, '<p>hi</p>');

    expect(result).toContain('content="Quotes &quot;like&quot; this &amp; that"');
  });

  it('links the route chunk’s stylesheets, which the template cannot know about', () => {
    // Vite attaches a lazy route's CSS to its chunk, so a direct visit paints
    // the prerendered markup unstyled until that JavaScript downloads.
    const result = injectMarkup(template, docs, '<p>hello</p>', ['/assets/ScoreFormula-def.css']);

    expect(result).toContain('<link rel="stylesheet" crossorigin href="/assets/ScoreFormula-def.css">');
    expect(result.indexOf('/assets/ScoreFormula-def.css')).toBeLessThan(result.indexOf('</head>'));
  });

  it('does not link a stylesheet the template already carries', () => {
    const result = injectMarkup(template, docs, '<p>hello</p>', ['/assets/index-abc.css']);

    expect(result.match(/assets\/index-abc\.css/g)).toHaveLength(1);
  });

  it('throws when the root element is not where it expects', () => {
    // Vite owns this template. If a future version emits a different root
    // element, injecting nothing would produce a build that silently went back
    // to a blank page - so this fails the build instead.
    expect(() => injectMarkup('<html><body></body></html>', landing, '<p>hi</p>')).toThrow('id="root"');
  });

  it('throws when a declared title has nothing to replace', () => {
    // A no-op replace ships the landing page's metadata under this URL, and
    // every behavioural test still passes.
    const headless = '<!doctype html><html><head></head><body><div id="root"></div></body></html>';

    expect(() => injectMarkup(headless, docs, '<p>hi</p>')).toThrow('<title>');
  });

  it('throws when a declared description has nothing to replace', () => {
    const untitled =
      '<!doctype html><html><head><title>tabstop</title></head><body><div id="root"></div></body></html>';

    expect(() => injectMarkup(untitled, docs, '<p>hi</p>')).toThrow('description');
  });

  it('throws when there is no head to link the route stylesheets into', () => {
    const bodyOnly = '<!doctype html><html><body><div id="root"></div></body></html>';

    expect(() => injectMarkup(bodyOnly, landing, '<p>hi</p>', ['/assets/a.css'])).toThrow('</head>');
  });
});
