import {describe, expect, it} from 'vitest';
import {injectMarkup} from './inject';

const template = '<!doctype html><html><body><div id="root"></div></body></html>';

describe('injectMarkup', () => {
  it('preserves replacement patterns in the rendered markup', () => {
    // Dollar signs and ampersands are common in rendered content (prices, entities).
    // String.replace() with a string argument interprets $& and $$ as replacement
    // patterns, which silently corrupts the output. This test ensures they are
    // preserved literally.
    const htmlWithPatterns = '<p>Price: $& off, $$ special</p>';
    const result = injectMarkup(template, '/', htmlWithPatterns);
    expect(result).toContain('Price: $& off, $$ special');
  });

  it('fills the root element with the rendered markup', () => {
    expect(injectMarkup(template, '/', '<p>hello</p>')).toContain('<p>hello</p>');
  });

  it('stamps the path that was rendered, so the client can check it', () => {
    expect(injectMarkup(template, '/', '<p>hello</p>')).toContain('data-prerendered="/"');
  });

  it('leaves the rest of the document alone', () => {
    const result = injectMarkup(template, '/', '<p>hello</p>');

    expect(result.startsWith('<!doctype html><html><body>')).toBe(true);
    expect(result.endsWith('</body></html>')).toBe(true);
  });

  it('throws when the root element is not where it expects', () => {
    // Vite owns this template. If a future version emits a different root
    // element, injecting nothing would produce a build that silently went back
    // to a blank page - so this fails the build instead.
    expect(() => injectMarkup('<html><body></body></html>', '/', '<p>hi</p>')).toThrow('id="root"');
  });
});
