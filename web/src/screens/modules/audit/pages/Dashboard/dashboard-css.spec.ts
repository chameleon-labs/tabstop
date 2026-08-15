// @vitest-environment node
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const SHEETS = {
  dashboard: 'src/screens/modules/audit/pages/Dashboard/dashboard.css',
  row: 'src/screens/modules/audit/components/PageRow/page-row.css',
  addForm: 'src/screens/modules/audit/components/AddPageForm/add-page-form.css',
  dialog: 'src/screens/modules/audit/components/DeletePageDialog/delete-page-dialog.css',
  toast: 'src/screens/components/ToastRegion/toast-region.css',
  delta: 'src/screens/modules/audit/components/ScoreDelta/score-delta.css',
  sparkline: 'src/screens/modules/audit/components/Sparkline/sparkline.css',
} as const;

const read = (path: string): string => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const sheets = Object.entries(SHEETS).map(([name, path]) => [name, read(path)] as const);

describe('the dashboard visual contract', () => {
  it.each(sheets)('keeps %s free of raw colour', (_name, css) => {
    // A literal here is a colour that cannot follow the theme, and both themes
    // ship from the same stylesheet.
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
    expect(sheets.find(([name]) => name === 'dashboard')?.[1]).toContain('var(--lat-container-content)');
  });

  it('draws each row state from a semantic token rather than a new palette', () => {
    const css = sheets.find(([name]) => name === 'row')?.[1] ?? '';

    for (const state of ['scored', 'failed', 'paused', 'first-audit', 'unstarted'] as const) {
      expect(css).toContain(`[data-state='${state}']`);
    }
    expect(css).toContain('var(--lat-danger-solid)');
    expect(css).toContain('var(--lat-success-solid)');
    expect(css).toContain('var(--lat-warning-solid)');
  });

  it('keeps the row readable when colour is taken away', () => {
    // The leading edge is the row's signature device and the first thing a
    // forced-colours palette flattens.
    expect(sheets.find(([name]) => name === 'row')?.[1]).toContain('@media (forced-colors: active)');
  });

  it('lets a long url wrap rather than push the row sideways', () => {
    const css = sheets.find(([name]) => name === 'row')?.[1] ?? '';

    expect(css).toContain('min-inline-size: 0');
    expect(css).toContain('overflow-wrap: anywhere');
  });

  it('animates the toast only where motion is welcome', () => {
    const css = sheets.find(([name]) => name === 'toast')?.[1] ?? '';

    expect(css).toContain('@media (prefers-reduced-motion: no-preference)');
    expect(css.slice(0, css.indexOf('@media (prefers-reduced-motion'))).not.toMatch(/animation:|transition:/);
  });

  it('keeps the toast stack inside the viewport on a narrow screen', () => {
    const css = sheets.find(([name]) => name === 'toast')?.[1] ?? '';

    expect(css).toContain('min(100vw');
    expect(css).toContain('@media (width < 30rem)');
  });

  it('keeps the dialog inside the viewport', () => {
    expect(sheets.find(([name]) => name === 'dialog')?.[1]).toContain('min(100vw');
  });

  it.each(['dashboard', 'row', 'addForm'] as const)('gives %s a small-screen composition', (name) => {
    expect(sheets.find(([sheet]) => sheet === name)?.[1]).toMatch(/@media \(width [<>]/);
  });
});
