import {render, screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {PRERENDER_PAGES} from '@/prerender/paths';
import {Providers} from '@/test/render';
import {ScoreFormula} from './index';

const renderPage = () =>
  render(
    <Providers>
      <ScoreFormula />
    </Providers>,
  );

const rowText = (row: HTMLElement): string =>
  [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '').join(' ');

describe('ScoreFormula', () => {
  it('presents the exact public document outline with identified, linkable sections', () => {
    renderPage();

    expect(screen.getByRole('heading', {level: 1, name: 'How the score is calculated'})).toBeVisible();
    expect(screen.getAllByRole('heading', {level: 1})).toHaveLength(1);
    expect(screen.getAllByRole('heading', {level: 2}).map((heading) => heading.textContent?.replace('#', ''))).toEqual([
      'What the score is for',
      'The formula',
      'Impact weights',
      'The per-rule element cap',
      'Worked example',
      'Version comparability',
      'What the score does not measure',
      "Why not Lighthouse's accessibility score?",
      'Limitations',
    ]);

    const sections = screen
      .getAllByRole('heading', {level: 2})
      .map((heading) => heading.closest('section'))
      .filter((section): section is HTMLElement => section !== null);

    expect(sections.map(({id}) => id)).toEqual([
      'purpose',
      'formula',
      'weights',
      'cap',
      'worked-example',
      'versioning',
      'not-measured',
      'vs-lighthouse',
      'limitations',
    ]);

    for (const section of sections) {
      const heading = section.querySelector('h2')!;
      const title = heading.textContent?.replace('#', '') ?? '';
      expect(within(section).getByRole('link', {name: `Permalink to ${title}`})).toHaveAttribute(
        'href',
        `#${section.id}`,
      );
    }
  });

  it('sets the same title its prerendered artifact publishes', () => {
    renderPage();

    expect(document.title).toBe(PRERENDER_PAGES.find(({path}) => path === '/docs/score-formula')?.title);
  });

  it('leaves the main landmark to the shared application shell', () => {
    renderPage();

    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('states the complete static formula and defensive scoring behavior', () => {
    renderPage();

    expect(screen.getByText('penalty(rule) = min(affected_element_count, 5) × weight(impact)')).toBeVisible();
    expect(screen.getByText('score = max(0, 100 − Σ penalty(rule) over unique violated rules)')).toBeVisible();
    expect(screen.getByText(/Duplicate rule ids are combined defensively/i)).toBeVisible();
    expect(screen.getByText(/node counts are added/i)).toBeVisible();
    expect(screen.getByText(/most severe known impact is kept/i)).toBeVisible();
    expect(screen.getByText(/floor is 0 and its ceiling is 100/i)).toBeVisible();
  });

  it('publishes the corrected impact weights, caps, and unrated treatment', () => {
    renderPage();

    const table = screen.getByRole('table', {name: 'Score impact weights and per-rule maximum deductions'});
    const rows = within(table).getAllByRole('row').slice(1).map(rowText);

    expect(rows).toEqual([
      'critical 10 50 Blocks access entirely for some users',
      'serious 5 25 Significantly impairs use',
      'moderate 2 10 Causes difficulty or confusion',
      'minor 1 5 Creates friction; rarely blocks',
      'unrated 1 5 Still counts when axe reports no impact',
    ]);
    expect(screen.getByText(/Unrated is not a fifth severity/i)).toBeVisible();
    expect(screen.getByText(/does not enter the four impact-count buckets/i)).toBeVisible();
    expect(screen.getByText(/deducts at weight 1/i)).toBeVisible();
    expect(screen.getByText(/weights are fixed and not configurable/i)).toBeVisible();
  });

  it('shows the corrected worked deduction ledger and its cap', () => {
    renderPage();

    expect(screen.getByText('acme.example/checkout')).toBeVisible();
    expect(screen.getByText('axe-core 4.12.1')).toBeVisible();

    const table = screen.getByRole('table', {name: 'Worked score calculation for acme.example/checkout'});
    const rows = within(table).getAllByRole('row').slice(1).map(rowText);

    expect(rows).toEqual([
      'critical label 3 3 ×10 30',
      'serious link-name 1 1 ×5 5',
      'minor region capped at 5 elements 8 5 ×1 5',
      'Total penalties 40',
      'Score 60',
    ]);
    expect(screen.getByText(/100 − \(30 \+ 5 \+ 5\) = 60/)).toBeVisible();
  });

  it('keeps both data tables captioned and every header explicitly scoped', () => {
    renderPage();

    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(2);

    for (const table of tables) {
      expect(table.querySelector('caption')).not.toBeNull();
      const headers = [...table.querySelectorAll('th')];
      expect(headers.length).toBeGreaterThan(0);
      expect(headers.every((header) => ['col', 'row'].includes(header.getAttribute('scope') ?? ''))).toBe(true);
    }
  });

  it('frames the score as a regression signal and states its version boundary', () => {
    renderPage();

    expect(screen.getByText(/A score of 60 does not mean.*60% accessible/i)).toBeVisible();
    expect(
      screen.getByText(/100 means no automated violations were detected, not that the page is accessible/i),
    ).toBeVisible();
    expect(screen.getByText(/only comparable within the same axe-core version/i)).toBeVisible();
    expect(screen.getByText(/stores the axe-core version with each audit/i)).toBeVisible();
    expect(screen.getByText(/Consumers can distinguish version boundaries/i)).toBeVisible();
  });

  it('says why axe-core ships no score, and that this one is not a standard', () => {
    const {container} = renderPage();
    const formula = container.querySelector<HTMLElement>('section#formula')!;
    const text = formula.textContent?.replace(/\s+/g, ' ') ?? '';

    expect(text).toMatch(/axe-core reports violations and does not produce a score/i);
    expect(text).toMatch(/is not a standard/i);
    expect(text).toMatch(/no specification defines it/i);
  });

  it('uses primary sources and accurately distinguishes Lighthouse scoring', () => {
    renderPage();

    expect(screen.getByRole('link', {name: 'axe-core'})).toHaveAttribute(
      'href',
      'https://github.com/dequelabs/axe-core',
    );
    expect(screen.getByRole('link', {name: "Lighthouse's accessibility scoring"})).toHaveAttribute(
      'href',
      'https://developer.chrome.com/docs/lighthouse/accessibility/scoring/',
    );
    expect(screen.getByText(/weighted average of pass\/fail accessibility audits/i)).toBeVisible();
    expect(screen.getByText(/affected elements per unique violated rule/i)).toBeVisible();
  });

  it('uses real lists and non-live notices to state what automation cannot establish', () => {
    const {container} = renderPage();
    const notMeasured = container.querySelector<HTMLElement>('section#not-measured')!;
    const limitations = container.querySelector<HTMLElement>('section#limitations')!;
    const notMeasuredList = within(notMeasured).getByRole('list');
    const limitationsList = within(limitations).getByRole('list');

    expect(container.querySelectorAll('ul.score-formula__list')).toHaveLength(2);
    expect(notMeasuredList).not.toHaveAttribute('role');
    expect(limitationsList).not.toHaveAttribute('role');

    expect(
      within(notMeasuredList)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Whether alt text is meaningful, accurate, or helpful—not merely present',
      'Whether focus order is logical for keyboard navigation',
      'Whether the page is actually usable with a screen reader',
      'Whether touch targets are large enough in practice',
      'Whether content is readable and understandable',
      'Whether animations respect prefers-reduced-motion',
      'Whether the page works without CSS or JavaScript',
      'Performance and responsiveness under assistive technology',
    ]);
    expect(
      within(limitationsList)
        .getAllByRole('listitem')
        .map((item) => item.textContent?.replace(/\s+/g, ' ').trim()),
    ).toEqual([
      'Automated rules catch a minority of real accessibility barriers — commonly estimated at roughly a third, and the share varies substantially from site to site.',
      '100 means no automated violations were detected, not that the page is accessible.',
      'Manual testing and testing with disabled people remain necessary.',
      'One Chromium snapshot with JavaScript enabled at one viewport omits dynamic states, other widths, and other browsers.',
    ]);

    const callouts = [...container.querySelectorAll('.score-formula__callout')];
    expect(callouts).toHaveLength(4);
    for (const callout of callouts) {
      expect(callout).not.toHaveAttribute('role');
      expect(callout).not.toHaveAttribute('aria-live');
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('provides named focusable overflow regions only around the wide tables', () => {
    renderPage();

    const regions = screen.getAllByRole('region');
    const impactRegion = screen.getByRole('region', {name: 'Impact weights table'});
    const exampleRegion = screen.getByRole('region', {name: 'Worked score example table'});

    expect(regions).toHaveLength(2);
    expect(impactRegion).toHaveAttribute('tabindex', '0');
    expect(exampleRegion).toHaveAttribute('tabindex', '0');
    expect(
      within(impactRegion).getByRole('table', {name: 'Score impact weights and per-rule maximum deductions'})
        .parentElement,
    ).toBe(impactRegion);
    expect(
      within(exampleRegion).getByRole('table', {name: 'Worked score calculation for acme.example/checkout'})
        .parentElement,
    ).toBe(exampleRegion);
    expect(screen.getByRole('link', {name: '← tabstop'})).toHaveAttribute('href', '/');
  });
});
