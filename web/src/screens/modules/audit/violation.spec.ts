import {describe, expect, it} from 'vitest';
import {crossesFrames, describeTarget, safeHelpUrl} from './violation';

describe('describeTarget', () => {
  it('leaves an ordinary selector alone', () => {
    expect(describeTarget(['html > body > img'])).toBe('html > body > img');
  });

  it('does not turn a frame chain into a descendant selector', () => {
    // The bug this exists to prevent. `['iframe#embed', '#inside']` means "in
    // that frame, this element". Joined with a space it becomes
    // `iframe#embed #inside` - a valid selector for a completely different
    // element that almost certainly does not exist. It looks right, and it is
    // wrong in a way nobody would question.
    const shown = describeTarget(['iframe#embed', '#inside']);

    expect(shown).not.toBe('iframe#embed #inside');
    expect(shown).toContain('iframe#embed');
    expect(shown).toContain('#inside');
  });

  it('leaves the shadow-DOM notation the server already produced', () => {
    // Shadow segments never reach here as separate entries: the server flattens
    // them with axe's own ` >>> ` piercing notation first. So every entry that
    // survives into this array is a frame.
    expect(describeTarget(['#host >>> input'])).toBe('#host >>> input');
  });
});

describe('crossesFrames', () => {
  it('is false for a plain selector and true for a chain', () => {
    expect(crossesFrames(['img'])).toBe(false);
    expect(crossesFrames(['iframe', 'img'])).toBe(true);
  });
});

describe('safeHelpUrl', () => {
  it('passes an ordinary axe documentation link', () => {
    expect(safeHelpUrl('https://dequeuniversity.com/rules/axe/4.12/image-alt')).toBe(
      'https://dequeuniversity.com/rules/axe/4.12/image-alt',
    );
  });

  it('keeps the query string axe appends', () => {
    expect(safeHelpUrl('https://dequeuniversity.com/rules/axe/4.12/label?application=axeAPI')).toBe(
      'https://dequeuniversity.com/rules/axe/4.12/label?application=axeAPI',
    );
  });

  describe('the origin is the check, not the scheme', () => {
    it('refuses another https origin, which a scheme test waves through', () => {
      // The whole risk, and what an earlier version of this function missed.
      // `https://evil.example/phish` passes a protocol check perfectly. What it
      // buys is a link reading "How to fix this", inside an accessibility
      // report, on a share page (#23) anybody can send to a colleague. Script
      // execution was never the dangerous part - the origin was.
      expect(safeHelpUrl('https://evil.example/phish')).toBeNull();
    });

    it('refuses a lookalike host', () => {
      expect(safeHelpUrl('https://dequeuniversity.com.evil.example/rules')).toBeNull();
      expect(safeHelpUrl('https://notdequeuniversity.com/rules')).toBeNull();
    });

    it('refuses a subdomain, since the engine never uses one', () => {
      // A wildcard would admit anything Deque ever delegates, and the vendored
      // engine builds every link on the bare host.
      expect(safeHelpUrl('https://evil.dequeuniversity.com/rules')).toBeNull();
    });

    it('refuses a non-default port on the right host', () => {
      // `https://dequeuniversity.com:8443/` shares the hostname and is a
      // different origin. A hostname check accepted it while the comment above
      // claimed the exact origin was allowlisted.
      expect(safeHelpUrl('https://dequeuniversity.com:8443/rules/axe/4.12/label')).toBeNull();
    });

    it('refuses plain http even on the right host', () => {
      // `helpUrlBase` is https. An http link is either downgraded or forged,
      // and neither is worth rendering.
      expect(safeHelpUrl('http://dequeuniversity.com/rules/axe/4.12/label')).toBeNull();
    });

    it('refuses credentials smuggled into the authority', () => {
      // `https://dequeuniversity.com@evil.example/` has hostname
      // `evil.example`, and reads to a person as the trusted host.
      expect(safeHelpUrl('https://dequeuniversity.com@evil.example/')).toBeNull();
    });
  });

  it.each([
    ['javascript:alert(document.cookie)', 'script execution'],
    ['data:text/html,<script>alert(1)</script>', 'attacker HTML in a null origin'],
    ['vbscript:msgbox(1)', 'another executable scheme'],
    ['file:///etc/passwd', 'the local filesystem'],
    ['not a url at all', 'unparseable'],
  ])('refuses %p - %s', (helpUrl) => {
    expect(safeHelpUrl(helpUrl)).toBeNull();
  });

  it('refuses an empty string, which is what the server writes when it drops one', () => {
    expect(safeHelpUrl('')).toBeNull();
  });
});
