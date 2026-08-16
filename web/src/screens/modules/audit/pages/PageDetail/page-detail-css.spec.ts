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
    const css = sheet('chart');

    expect(css).toContain('@media (forced-colors: active)');
    expect(css.slice(css.indexOf('@media (forced-colors: active)'))).toContain('CanvasText');
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

  it('stacks the summary card rather than squeezing three columns onto a phone', () => {
    const narrow = sheet('detail').slice(sheet('detail').indexOf('@media (width < 40rem)'));

    expect(narrow).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});
