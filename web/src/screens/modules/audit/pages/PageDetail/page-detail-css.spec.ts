// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const SHEETS = {
  detail: 'src/screens/modules/audit/pages/PageDetail/page-detail.css',
  chart: 'src/screens/modules/audit/components/TrendChart/trend-chart.css',
  table: 'src/screens/modules/audit/components/HistoryTable/history-table.css',
  list: 'src/screens/modules/audit/components/AuditList/audit-list.css',
  panel: 'src/screens/modules/audit/components/AuditPanel/audit-panel.css',
} as const;

const read = (path: string): string => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const sheets = Object.entries(SHEETS).map(([name, path]) => [name, read(path)] as const);

const sheet = (name: keyof typeof SHEETS): string => sheets.find(([found]) => found === name)?.[1] ?? '';

describe('the page detail visual contract', () => {
  it.each(sheets)('keeps %s free of raw colour', (_name, css) => {
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i);
  });

  it.each(sheets)('keeps %s free of hardcoded type', (_name, css) => {
    // Read the value rather than lookahead past the colon: `\s*` backtracks to
    // nothing, so `font-family:\s*(?!var\()` matches every declaration ever
    // written with a space after the colon.
    const values = [...css.matchAll(/font-family:\s*([^;]+);/gi)].map(([, value]) => value!.trim());

    expect(values.filter((value) => !value.startsWith('var(--lat-'))).toEqual([]);
  });

  it('bounds the page with the shared content width', () => {
    expect(sheet('detail')).toContain('var(--lat-container-content)');
  });

  it('draws each impact count from its severity token rather than a new palette', () => {
    for (const impact of ['critical', 'serious', 'moderate', 'minor'] as const) {
      expect(sheet('detail')).toContain(`[data-impact='${impact}']`);
      expect(sheet('detail')).toContain(`var(--lat-severity-${impact})`);
    }
  });

  it('scales the chart from its own box, so nothing has to measure it', () => {
    // A viewBox and a percentage width keep the aspect ratio without a resize
    // observer, which jsdom cannot report anyway.
    expect(sheet('chart')).toContain('inline-size: 100%');
    expect(sheet('chart')).toContain('block-size: auto');
  });

  it('keeps the chart readable when colour is taken away', () => {
    // `fill` is not force-adjusted by the browser, and a bare
    // `.trend-chart__point` here loses to the state rules above it - so a
    // failed marker kept its brand red against whatever palette was chosen.
    const forced = sheet('chart').slice(sheet('chart').indexOf('@media (forced-colors: active)'));

    expect(sheet('chart')).toContain('@media (forced-colors: active)');
    for (const selector of [
      '.trend-chart__line',
      '.trend-chart__version',
      '.trend-chart__point',
      ".trend-chart__point[data-status='failed']",
      ".trend-chart__point[data-endpoint='true']",
    ]) {
      expect(forced).toContain(selector);
    }
    expect(forced).toContain('CanvasText');
  });

  it('animates the tooltip only where motion is welcome', () => {
    const css = sheet('chart');

    expect(css).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(css.slice(0, css.indexOf('@media (prefers-reduced-motion'))).not.toMatch(/animation:|transition:/);
  });

  it('scrolls the wide table inside its own region', () => {
    expect(sheet('table')).toContain('overflow-x: auto');
  });

  it.each(['detail', 'table', 'list', 'panel'] as const)('gives %s a small-screen composition', (name) => {
    expect(sheet(name)).toMatch(/@media \(width [<>]/);
  });

  it('keeps the audited time against the right edge, counts or no counts', () => {
    // End-alignment alone leaves it beside the score on a page whose first
    // audit has produced no counts, because the middle column collapses.
    const wide = sheet('detail').slice(0, sheet('detail').indexOf('@media (width < 40rem)'));

    expect(wide).toMatch(/\.page-detail__latest\s*{[^}]*grid-column: 3;/);
  });

  it('stacks the summary card rather than squeezing three columns onto a phone', () => {
    const narrow = sheet('detail').slice(sheet('detail').indexOf('@media (width < 40rem)'));

    expect(narrow).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});
