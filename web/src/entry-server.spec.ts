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
});
