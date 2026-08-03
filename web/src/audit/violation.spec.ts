import { describe, expect, it } from 'vitest'
import { crossesFrames, describeTarget, safeHelpUrl } from './violation'

describe('describeTarget', () => {
  it('leaves an ordinary selector alone', () => {
    expect(describeTarget(['html > body > img'])).toBe('html > body > img')
  })

  it('does not turn a frame chain into a descendant selector', () => {
    // The bug this exists to prevent. `['iframe#embed', '#inside']` means "in
    // that frame, this element". Joined with a space it becomes
    // `iframe#embed #inside` - a valid selector for a completely different
    // element that almost certainly does not exist. It looks right, and it is
    // wrong in a way nobody would question.
    const shown = describeTarget(['iframe#embed', '#inside'])

    expect(shown).not.toBe('iframe#embed #inside')
    expect(shown).toContain('iframe#embed')
    expect(shown).toContain('#inside')
  })

  it('leaves the shadow-DOM notation the server already produced', () => {
    // Shadow segments never reach here as separate entries: the server flattens
    // them with axe's own ` >>> ` piercing notation first. So every entry that
    // survives into this array is a frame.
    expect(describeTarget(['#host >>> input'])).toBe('#host >>> input')
  })
})

describe('crossesFrames', () => {
  it('is false for a plain selector and true for a chain', () => {
    expect(crossesFrames(['img'])).toBe(false)
    expect(crossesFrames(['iframe', 'img'])).toBe(true)
  })
})

describe('safeHelpUrl', () => {
  it('passes an ordinary documentation link', () => {
    expect(safeHelpUrl('https://dequeuniversity.com/rules/axe/4.12/image-alt'))
      .toBe('https://dequeuniversity.com/rules/axe/4.12/image-alt')
  })

  it('allows http, since not every rule doc is https yet', () => {
    expect(safeHelpUrl('http://example.test/rule')).toBe('http://example.test/rule')
  })

  it.each([
    ['javascript:alert(document.cookie)', 'script execution'],
    ['data:text/html,<script>alert(1)</script>', 'attacker HTML in a null origin'],
    ['vbscript:msgbox(1)', 'another executable scheme'],
    ['file:///etc/passwd', 'the local filesystem'],
    ['not a url at all', 'unparseable']
  ])('refuses %p - %s', (helpUrl) => {
    // `helpUrl` LOOKS like our data and is not: it comes from `window.axe`
    // inside the audited page, and the audited page can replace that object
    // before the engine runs. React blocks `javascript:` on its own, but not
    // `data:` and not an arbitrary remote origin - a link reading "How to fix
    // this", inside an accessibility report, pointing wherever an audited site
    // chose. The share page (#23) makes that one anybody can send to a colleague.
    expect(safeHelpUrl(helpUrl)).toBeNull()
  })

  it('refuses an empty string, which is what the server writes when it drops one', () => {
    expect(safeHelpUrl('')).toBeNull()
  })
})
