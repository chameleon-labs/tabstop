import type {Impact, Violation} from '@tabstop/contract';
import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import {ViolationList} from './index';
import {EXPAND_ALL_BELOW} from '../../grouping';

const violation = (impact: Impact | null, ruleId: string, over: Partial<Violation> = {}): Violation => ({
  ruleId,
  impact,
  description: `Description for ${ruleId}`,
  helpUrl: `https://dequeuniversity.com/rules/axe/${ruleId}`,
  nodes: [{target: ['html > body > div'], html: '<div id="x">hi</div>'}],
  ...over,
});

const many = (count: number): Violation[] => Array.from({length: count}, (_, i) => violation('serious', `rule-${i}`));

describe('ViolationList', () => {
  it('says so plainly when there is nothing to report', () => {
    render(<ViolationList violations={[]} />);

    expect(screen.getByText(/No accessibility violations were found/)).toBeVisible();
  });

  it('reports the tally the reader is looking for', () => {
    render(<ViolationList violations={[violation('minor', 'a'), violation('critical', 'b')]} />);

    expect(screen.getByRole('region', {name: 'Violations — 2 total'})).toBeInTheDocument();
  });

  it('names each markup region for the rule it belongs to, not its place in one panel', () => {
    render(<ViolationList violations={[violation('critical', 'image-alt'), violation('serious', 'color-contrast')]} />);

    const markup = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label'))
      .filter((name) => name !== null && name.includes('affected element'));

    expect(markup).toHaveLength(2);
    expect(new Set(markup).size).toBe(2);
  });

  it('keeps the nodes of one rule apart from each other too', () => {
    render(
      <ViolationList
        violations={[
          violation('critical', 'image-alt', {
            nodes: [
              {target: ['img.hero'], html: '<img class="hero">'},
              {target: ['img.thumb'], html: '<img class="thumb">'},
            ],
          }),
        ]}
      />,
    );

    const markup = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label'))
      .filter((name) => name !== null && name.includes('affected element'));

    expect(markup).toHaveLength(2);
    expect(new Set(markup).size).toBe(2);
  });

  it('lists every finding in one list, most severe first', () => {
    render(<ViolationList violations={[violation('minor', 'a'), violation('critical', 'b')]} />);

    const rows = screen.getAllByRole('button', {expanded: true}).map((row) => row.textContent);

    expect(rows[0]).toContain('b');
    expect(rows[1]).toContain('a');
  });

  it("carries the severity in each row's own name, since there are no longer sections", () => {
    render(<ViolationList violations={[violation('critical', 'b')]} />);

    expect(screen.getByRole('button', {name: /^critical b Description for b/})).toBeVisible();
  });

  it('shows unrated findings rather than hiding them', () => {
    render(<ViolationList violations={[violation(null, 'a')]} />);

    expect(screen.getByRole('button', {name: /^unrated a/})).toBeVisible();
  });

  describe('the disclosure', () => {
    it('is a real button reporting its own state', async () => {
      render(<ViolationList violations={many(EXPAND_ALL_BELOW)} />);

      const [button] = screen.getAllByRole('button');

      expect(button).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(button as HTMLElement);
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('names no panel while there is none, rather than pointing at a missing id', async () => {
      render(<ViolationList violations={many(EXPAND_ALL_BELOW)} />);
      const trigger = screen.getAllByRole('button')[0] as HTMLElement;

      expect(trigger).not.toHaveAttribute('aria-controls');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      await userEvent.click(trigger);

      const id = trigger.getAttribute('aria-controls') ?? '';
      expect(document.getElementById(id)).toBeVisible();
    });

    it('does not build the panel contents while collapsed', async () => {
      render(<ViolationList violations={many(EXPAND_ALL_BELOW)} />);

      expect(screen.queryByText('<div id="x">hi</div>')).not.toBeInTheDocument();
      expect(screen.queryByText('html > body > div')).not.toBeInTheDocument();

      await userEvent.click(screen.getAllByRole('button')[0] as HTMLElement);

      expect(screen.getByText('html > body > div')).toBeVisible();
    });

    it('is reachable and operable from the keyboard alone', async () => {
      render(<ViolationList violations={many(EXPAND_ALL_BELOW)} />);

      await userEvent.tab();
      const focused = document.activeElement;
      expect(focused).toHaveAttribute('aria-expanded', 'false');

      await userEvent.keyboard('{Enter}');
      expect(focused).toHaveAttribute('aria-expanded', 'true');
    });

    it('opens everything on a short list, so two problems need no clicks', () => {
      render(<ViolationList violations={many(EXPAND_ALL_BELOW - 1)} />);

      const triggers = screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-expanded'));
      expect(triggers).toHaveLength(EXPAND_ALL_BELOW - 1);
      for (const trigger of triggers) {
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
      }
    });

    it('collapses a long one, because forty findings is a wall', () => {
      render(<ViolationList violations={many(EXPAND_ALL_BELOW)} />);

      for (const button of screen.getAllByRole('button')) {
        expect(button).toHaveAttribute('aria-expanded', 'false');
      }
    });
  });

  describe('what an expanded finding shows', () => {
    it('renders the HTML snippet as TEXT, never as markup', () => {
      const hostile = '<img src=x onerror="document.title=\'pwned\'"><script>alert(1)</script>';
      render(
        <ViolationList
          violations={[
            violation('critical', 'a', {
              nodes: [{target: ['body > img'], html: hostile}],
            }),
          ]}
        />,
      );

      expect(screen.getByText(hostile)).toBeVisible();
      expect(document.querySelector('img')).toBeNull();
      expect(document.querySelector('script')).toBeNull();
      expect(document.title).not.toBe('pwned');
    });

    it('shows the selector that locates the element', () => {
      render(<ViolationList violations={[violation('critical', 'a')]} />);

      expect(screen.getByText('html > body > div')).toBeVisible();
    });

    it('links to the rule help with a name that survives being read alone', () => {
      render(<ViolationList violations={[violation('critical', 'image-alt')]} />);

      const link = screen.getByRole('link', {name: /image-alt/});

      expect(link).toHaveAttribute('href', 'https://dequeuniversity.com/rules/axe/image-alt');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });

    it('does not turn a frame chain into a descendant selector', () => {
      render(
        <ViolationList
          violations={[
            violation('critical', 'a', {
              nodes: [{target: ['iframe#embed', '#inside'], html: '<b/>'}],
            }),
          ]}
        />,
      );

      expect(screen.queryByText('iframe#embed #inside')).not.toBeInTheDocument();
      expect(screen.getByText(/iframe#embed/)).toBeVisible();
    });

    it('renders no link at all when helpUrl is not a web address', () => {
      render(
        <ViolationList
          violations={[
            violation('critical', 'a', {
              helpUrl: 'data:text/html,<script>alert(1)</script>',
            }),
          ]}
        />,
      );

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getByText('a', {selector: 'code'})).toBeVisible();
    });

    it('says so when a rule reported no specific elements', () => {
      render(<ViolationList violations={[violation('critical', 'a', {nodes: []})]} />);

      expect(screen.getByText(/No specific elements were reported/)).toBeVisible();
    });

    it('lists every affected node', () => {
      render(
        <ViolationList
          violations={[
            violation('critical', 'a', {
              nodes: [
                {target: ['#one'], html: '<i>1</i>'},
                {target: ['#two'], html: '<i>2</i>'},
              ],
            }),
          ]}
        />,
      );

      const panel = screen.getByRole('button', {name: /^critical a/}).nextElementSibling as HTMLElement;

      expect(within(panel).getByText('#one')).toBeVisible();
      expect(within(panel).getByText('#two')).toBeVisible();
    });
  });
});
