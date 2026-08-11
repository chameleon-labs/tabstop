// @vitest-environment node
//
// No jsdom on purpose. The build renders this in plain Node, so a spec that
// grants it a DOM would pass while the build broke.
import {describe, expect, it} from 'vitest';
import {render} from './entry-server';

describe('the prerenderer', () => {
  it('renders the landing page without a DOM', async () => {
    const html = await render('/');

    expect(html).toContain('<main');
    // Contiguous hero copy. The h1 itself is split by <br/>, so asserting
    // "Accessibility monitoring" would fail against correct output.
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
    // The landing is `sessionFree`, so its header renders the signed-out state
    // immediately rather than the empty `<nav>` `AccountNavigation` shows while
    // `/me` is in flight. Without that, the page this exists to make paint fast
    // would paint with a hole where the header's controls belong.
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
    // A guarded route's loader would run here and issue `GET /api/me` against
    // nothing at all. No guarded route is prerendered, and the landing must not
    // become the first one that asks.
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
});
