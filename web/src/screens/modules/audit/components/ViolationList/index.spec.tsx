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

  it('lists every finding in one list, most severe first', () => {
    // Flat rather than grouped: one ordering, as the design has it.
    render(<ViolationList violations={[violation('minor', 'a'), violation('critical', 'b')]} />);

    // The disclosure triggers specifically: an open panel contributes list
    // items and a copy button of its own, and this is about the findings.
    const rows = screen.getAllByRole('button', {expanded: true}).map((row) => row.textContent);

    expect(rows[0]).toContain('b');
    expect(rows[1]).toContain('a');
  });

  it("carries the severity in each row's own name, since there are no longer sections", () => {
    // What grouping used to provide. A reader hears "critical" before the rule
    // rather than having to find the section that holds it.
    render(<ViolationList violations={[violation('critical', 'b')]} />);

    expect(screen.getByRole('button', {name: /^critical b Description for b/})).toBeVisible();
  });

  it('shows unrated findings rather than hiding them', () => {
    // axe reports violations with no severity, and they are real findings. A
    // list that drops them is the product failing at its one job.
    render(<ViolationList violations={[violation(null, 'a')]} />);

    expect(screen.getByRole('button', {name: /^unrated a/})).toBeVisible();
  });

  describe('the disclosure', () => {
    it('is a real button reporting its own state', async () => {
      // House style everywhere; here it is also the product's own claim. A
      // disclosure built from a div is one of the failures axe reports, and
      // shipping one inside an accessibility report would be quotable.
      render(<ViolationList violations={many(EXPAND_ALL_BELOW)} />);

      const [button] = screen.getAllByRole('button');

      expect(button).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(button as HTMLElement);
      expect(button).toHaveAttribute('aria-expanded', 'true');
    });

    it('names no panel while there is none, rather than pointing at a missing id', async () => {
      // The panel is unmounted while collapsed, so `aria-controls` goes with
      // it. That is the correct half of the trade: an attribute naming an id
      // that is not in the document is a broken relationship, and Ariakit
      // removes it rather than leaving one behind. `aria-expanded` is what
      // announces the state either way.
      render(<ViolationList violations={many(EXPAND_ALL_BELOW)} />);
      const trigger = screen.getAllByRole('button')[0] as HTMLElement;

      expect(trigger).not.toHaveAttribute('aria-controls');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      await userEvent.click(trigger);

      const id = trigger.getAttribute('aria-controls') ?? '';
      expect(document.getElementById(id)).toBeVisible();
    });

    it('does not build the panel contents while collapsed', async () => {
      // `hidden` removes a subtree from presentation, not from the document:
      // React still builds every node row and HTML snippet inside it. A long
      // report starts collapsed precisely because it is long, and axe can
      // return dozens of nodes per rule - so the collapsed case was the one
      // paying to construct thousands of elements nobody asked to see.
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

      // Only the rows: the panels carry a copy button each, which is not a
      // disclosure and has no expanded state to report.
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
      // `node.html` is attacker-controlled: a snippet captured from an
      // arbitrary third-party page, and this product exists to visit pages
      // nobody vetted. The instinct to "show the HTML properly" is the instinct
      // that would introduce stored XSS on a public share page.
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

      // The snippet is visible as characters...
      expect(screen.getByText(hostile)).toBeVisible();
      // ...and produced no elements and ran nothing.
      expect(document.querySelector('img')).toBeNull();
      expect(document.querySelector('script')).toBeNull();
      expect(document.title).not.toBe('pwned');
    });

    it('shows the selector that locates the element', () => {
      render(<ViolationList violations={[violation('critical', 'a')]} />);

      expect(screen.getByText('html > body > div')).toBeVisible();
    });

    it('links to the rule help with a name that survives being read alone', () => {
      // A list of links all reading "How to fix this" is useless in a screen
      // reader's link list. The rule id disambiguates without adding visual
      // noise.
      render(<ViolationList violations={[violation('critical', 'image-alt')]} />);

      const link = screen.getByRole('link', {name: /image-alt/});

      expect(link).toHaveAttribute('href', 'https://dequeuniversity.com/rules/axe/image-alt');
      expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });

    it('does not turn a frame chain into a descendant selector', () => {
      // `['iframe#embed', '#inside']` means "in that frame, this element".
      // Joined with a space it reads as `iframe#embed #inside` - a valid
      // selector for a different element that almost certainly does not exist.
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
      // `helpUrl` comes from `window.axe` inside the audited page, and the
      // audited page can replace that object before the engine runs. React
      // blocks `javascript:` itself, but not `data:` and not an arbitrary
      // remote origin - a link reading "How to fix this" inside an
      // accessibility report, pointing wherever an audited site chose.
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
      // The rule is still named in the panel, so the finding is not less
      // useful. Scoped to the `code`, since the row above names it too.
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
