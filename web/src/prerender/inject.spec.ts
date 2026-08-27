import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {injectAppShell, injectMarkup} from './inject';
import type {PrerenderedPage} from './paths';

const LATTICE_CSS = [
  ':root {',
  '  --lat-space-6: 1.5rem;',
  '  --lat-space-8: 2rem;',
  '  --lat-space-16: 4rem;',
  '  --lat-gray-text: oklch(0.15 0 0);',
  '  --lat-gray-bg: oklch(0.95 0 0);',
  '  --lat-bg: var(--lat-gray-bg);',
  '  --lat-text: var(--lat-gray-text);',
  '}',
  "[data-lat-theme='dark'] {",
  '  --lat-gray-text: oklch(0.91 0 0);',
  '}',
].join('\n');

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
    const result = injectMarkup(template, docs, '<p>hello</p>', ['/assets/ScoreFormula-def.css']);

    expect(result).toContain('<link rel="stylesheet" crossorigin href="/assets/ScoreFormula-def.css">');
    expect(result.indexOf('/assets/ScoreFormula-def.css')).toBeLessThan(result.indexOf('</head>'));
  });

  it('does not link a stylesheet the template already carries', () => {
    const result = injectMarkup(template, docs, '<p>hello</p>', ['/assets/index-abc.css']);

    expect(result.match(/assets\/index-abc\.css/g)).toHaveLength(1);
  });

  it('throws when the root element is not where it expects', () => {
    expect(() => injectMarkup('<html><body></body></html>', landing, '<p>hi</p>')).toThrow('id="root"');
  });

  it('throws when a declared title has nothing to replace', () => {
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

describe('injectAppShell', () => {
  const TEMPLATE = [
    '<!doctype html><html><head><title>tabstop</title>',
    '<script type="module" crossorigin src="/assets/index-abc.js"></script>',
    '<link rel="stylesheet" crossorigin href="/assets/index-abc.css">',
    '</head><body><div id="root"></div></body></html>',
  ].join('');

  const APP_CSS = [
    '/*\n * The shell, and no more than that.\n */',
    '* {\n  box-sizing: border-box;\n  padding: 0;\n  margin: 0;\n}',
    '.visually-hidden {\n  width: 1px;\n}',
  ].join('\n');

  const shell = (): string => injectAppShell(TEMPLATE, '.route-skeleton{gap:var(--lat-space-6)}', APP_CSS, LATTICE_CSS);

  it('paints a skeleton without waiting for anything the page has not got yet', () => {
    const output = shell();

    expect(output).toContain('class="route-skeleton"');
    expect(output).toContain('data-shape="generic"');
    expect(output).not.toContain('<div id="root"></div>');
  });

  it('puts the boot styles ahead of the stylesheet that would otherwise override them', () => {
    const output = shell();

    expect(output.indexOf('<style>')).toBeGreaterThan(-1);
    expect(output.indexOf('<style>')).toBeLessThan(output.indexOf('rel="stylesheet"'));
    expect(output.indexOf('<style>')).toBeLessThan(output.indexOf('<script type="module"'));
  });

  it('inlines the rules and the tokens they read, so nothing resolves to nothing', () => {
    const output = shell();
    const inline = output.slice(output.indexOf('<style>'), output.indexOf('</style>'));

    expect(inline).toContain('.route-skeleton{gap:var(--lat-space-6)}');
    expect(inline).toContain('--lat-space-6: 1.5rem');
  });

  it('upgrades the shape to the one the path asked for', () => {
    const output = shell();

    expect(output).toContain('__bootShape');
    expect(output).toContain('data-shape=\\"dashboard\\"');
  });

  it('leaves no stamp, so the client replaces it rather than hydrating onto it', () => {
    expect(shell()).not.toContain('data-prerendered');
  });

  it('does not hold the first paint for the stylesheet, which is the whole point', () => {
    const output = shell();

    expect(output).toContain('rel="preload"');
    expect(output).toMatch(/onload="this\.rel='stylesheet'"/);
    expect(output.slice(0, output.indexOf('<noscript>'))).not.toContain('<link rel="stylesheet"');
  });

  it('still styles the page for a visitor with no JavaScript', () => {
    expect(shell()).toContain('<noscript><link rel="stylesheet"');
  });

  it('reserves the header and the form’s own padding for the shape that centres itself', () => {
    const output = shell();
    const inline = output.slice(output.indexOf('<style>'), output.indexOf('</style>'));

    expect(inline).toContain("#root>.route-skeleton[data-shape='form']{min-block-size:100dvh");
    expect(inline).toContain('calc(3.5rem + var(--lat-space-16))');
  });

  it('inlines the sizing reset, so the boot paint is not a different size from the styled one', () => {
    const output = shell();
    const inline = output.slice(output.indexOf('<style>'), output.indexOf('</style>'));

    expect(inline).toContain('*{');
    expect(inline).toContain('box-sizing: border-box');
  });

  it('takes that reset from the sheet rather than restating it', () => {
    expect(() =>
      injectAppShell(TEMPLATE, '.route-skeleton{}', '.visually-hidden {\n  width: 1px;\n}', LATTICE_CSS),
    ).toThrow(/no longer declares \*/);
  });

  it('hides the loading text it would otherwise show as a stray word', () => {
    const output = shell();
    const inline = output.slice(output.indexOf('<style>'), output.indexOf('</style>'));

    expect(inline).toContain('.visually-hidden{');
  });

  it('paints its own background, since the sheet that would is no longer blocking', () => {
    const output = shell();
    const inline = output.slice(output.indexOf('<style>'), output.indexOf('</style>'));

    expect(inline).toMatch(/body\{[^}]*background/);
  });

  it('reserves the height the header actually takes', () => {
    const header = readFileSync('src/screens/components/SiteHeader/site-header.css', 'utf8');

    expect(header).toContain('min-block-size: 3.5rem');
    expect(shell()).toContain('3.5rem');
  });

  it('throws rather than shipping a shell with no skeleton in it', () => {
    expect(() => injectAppShell('<html><head></head><body></body></html>', '', APP_CSS, LATTICE_CSS)).toThrow(/root/);
  });

  it('throws when there is nowhere to put the styles ahead of the sheet', () => {
    const noAssets = '<!doctype html><html><head><title>t</title></head><body><div id="root"></div></body></html>';

    expect(() => injectAppShell(noAssets, '', APP_CSS, LATTICE_CSS)).toThrow(/stylesheet|module/);
  });
});
