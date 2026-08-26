// @vitest-environment node
//
// `readBootCss` resolves its files from `import.meta.url`; jsdom serves that
// over http, so `fileURLToPath` throws before a single test is collected.
import {describe, expect, it} from 'vitest';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bootShellPlugin, readBootCss, servedFromDisk, type BootCss} from './dev-shell';

const template =
  '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="/x.js"></script></body></html>';

const shellFor = (plugin: ReturnType<typeof bootShellPlugin>, url: string): string => {
  const hook = plugin.transformIndexHtml;
  if (typeof hook !== 'object' || typeof hook.handler !== 'function') {
    throw new Error('the plugin no longer exposes an object transformIndexHtml hook');
  }

  const html: unknown = Reflect.apply(hook.handler, undefined, [
    template,
    {path: url, filename: 'index.html', originalUrl: url},
  ]);
  if (typeof html !== 'string') {
    throw new Error('the transform no longer answers with html');
  }

  return html;
};

const cssReturning =
  (skeleton: string): (() => BootCss) =>
  () => ({
    skeleton,
    app: '* {\n  box-sizing: border-box;\n}\n.visually-hidden {\n  width: 1px;\n}',
    lattice:
      ":root {\n  --lat-bg: white;\n  --lat-text: black;\n  --lat-space-8: 2rem;\n  --lat-space-16: 4rem;\n}\n[data-lat-theme='dark'] {\n  --lat-bg: black;\n}",
  });

describe('the boot shell dev plugin', () => {
  it('never runs at build time, where the prerender script owns app.html', () => {
    expect(bootShellPlugin().apply).toBe('serve');
  });

  it('paints a skeleton into a guarded route, so dev does not go blank like the host would not', () => {
    const html = shellFor(bootShellPlugin(cssReturning('.route-skeleton{color:red}')), '/dashboard');

    expect(html).toContain('class="route-skeleton"');
    expect(html).toContain('.route-skeleton{color:red}');
  });

  it('leaves a prerendered path alone, because the host answers that one from its own file', () => {
    const html = shellFor(bootShellPlugin(cssReturning('.route-skeleton{color:red}')), '/');

    expect(html).toBe(template);
  });

  it('reads the css on every request, so an edit in dev is not served stale', () => {
    // Reading once when the config loads outlives the edit: Vite rebuilds the
    // application CSS graph and never tells this plugin, so a refresh serves
    // the old boot paint and then swaps to the new one when React arrives.
    const edits = ['.route-skeleton{color:red}', '.route-skeleton{color:blue}'];
    const plugin = bootShellPlugin(() => cssReturning(edits.shift() ?? 'exhausted')());

    const first = shellFor(plugin, '/dashboard');
    const second = shellFor(plugin, '/dashboard');

    expect(first).toContain('color:red');
    expect(second).toContain('color:blue');
    expect(second).not.toContain('color:red');
  });
});

describe('readBootCss', () => {
  it('reads the real sheets the shell inlines, so the fixtures above are not the only thing proven', () => {
    const css = readBootCss();

    expect(css.skeleton).toContain('.route-skeleton');
    expect(css.app).toContain('.visually-hidden');
    expect(css.lattice).toContain('--lat-');
  });
});

describe('servedFromDisk', () => {
  // The host's `_redirects` rule is a FALLBACK: `/*  /app.html  200` answers
  // only what no built file already answers. Preview has to ask the same
  // question of the same directory, or the two disagree.
  const here = dirname(fileURLToPath(import.meta.url));

  it('finds a file the build actually wrote, which preview must keep serving', () => {
    expect(servedFromDisk(here, '/paths.ts')).toBe(true);
  });

  it('does not find a route, however much it looks like a file', () => {
    // `/missing.html` is the case: React Router's catch-all takes it and the
    // host answers with app.html, so preview must not fall through to the
    // prerendered landing page instead.
    expect(servedFromDisk(here, '/missing.html')).toBe(false);
    expect(servedFromDisk(here, '/dashboard')).toBe(false);
  });

  it('does not treat a directory as something to serve', () => {
    expect(servedFromDisk(dirname(here), '/prerender')).toBe(false);
  });

  it('refuses a path that climbs out of the build output', () => {
    expect(servedFromDisk(here, '/../../package.json')).toBe(false);
  });

  it('answers a malformed path rather than throwing on it', () => {
    expect(servedFromDisk(here, '/%')).toBe(false);
  });
});
