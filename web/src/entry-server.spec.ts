// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {render} from './entry-server';

describe('the prerenderer', () => {
  it('renders the landing page without a DOM', async () => {
    const html = await render('/');

    expect(html).toContain('<main');
    expect(html).toContain('without the setup.');
  });

  it('includes the URL field, so the page is legible before hydration', async () => {
    const html = await render('/');

    expect(html).toContain('Page to audit');
  });

  it('produces the same markup twice, so a build is reproducible', async () => {
    expect(await render('/')).toBe(await render('/'));
  });

  it('prerenders a COMPLETE header, not one waiting on a session', async () => {
    const html = await render('/');

    expect(html).toContain('site-header');
    expect(html).toContain('>Log in<');
    expect(html).toContain('>Sign up<');
  });

  it("prerenders the section links, which are the landing page's own", async () => {
    const html = await render('/');

    expect(html).toContain('href="#how"');
    expect(html).toContain('href="#why"');
    expect(html).toContain('href="#scope"');
  });

  it('asks the API for nothing at build time', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.reject(new Error('the prerenderer must not reach the network'));
    }) as typeof fetch;

    try {
      await render('/');
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toEqual([]);
  });

  it('renders the score formula without a DOM or network access', async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.reject(new Error('the prerenderer must not reach the network'));
    }) as typeof fetch;

    try {
      const html = await render('/docs/score-formula');

      expect(html).toContain('How the score is calculated');
      expect(html).toContain('site-header');
      expect(html).toContain('id="main"');
      expect(html).toContain('href="#formula"');
      expect(html).toContain('href="#worked-example"');
    } finally {
      globalThis.fetch = original;
    }

    expect(calls).toEqual([]);
  });
});
