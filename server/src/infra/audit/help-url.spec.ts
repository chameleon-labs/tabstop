import { describe, expect, it } from 'vitest'
import { HELP_ORIGIN, safeHelpUrl } from './help-url.js'
import { toStoredViolations } from './playwright-axe-auditor.js'

describe('safeHelpUrl', () => {
  it('keeps a link on the origin axe builds them from', () => {
    expect(safeHelpUrl(`${HELP_ORIGIN}/rules/axe/4.12/image-alt`))
      .toBe(`${HELP_ORIGIN}/rules/axe/4.12/image-alt`)
  })

  it('keeps the query string axe appends', () => {
    expect(safeHelpUrl(`${HELP_ORIGIN}/rules/axe/4.12/label?application=axeAPI`))
      .toBe(`${HELP_ORIGIN}/rules/axe/4.12/label?application=axeAPI`)
  })

  describe('the origin is the check', () => {
    it.each([
      ['https://evil.example/phish', 'another https origin, which a scheme test allows'],
      ['https://dequeuniversity.com.evil.example/rules', 'a lookalike host'],
      ['https://evil.dequeuniversity.com/rules', 'a subdomain the engine never uses'],
      ['https://dequeuniversity.com@evil.example/', 'credentials smuggled into the authority'],
      ['https://dequeuniversity.com:8443/rules', 'a non-default port, which shares the host'],
      ['http://dequeuniversity.com/rules', 'plain http on the right host']
    ])('drops %p - %s', (helpUrl) => {
      // `helpUrl` is a string the AUDITED PAGE chose: it can replace
      // `window.axe` before the engine runs. Stored verbatim it becomes the
      // href of a link reading "How to fix this" inside an accessibility
      // report, on a share page anybody can forward. Phishing is the risk, so
      // the origin is the check - a scheme test waves most of these through.
      expect(safeHelpUrl(helpUrl)).toBe('')
    })
  })

  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'not a url',
    ''
  ])('drops %p', (helpUrl) => {
    expect(safeHelpUrl(helpUrl)).toBe('')
  })

  it('drops a value that is not a string at all', () => {
    // `run()` returns whatever the page decided to return. Nothing guarantees
    // the field is even a string.
    expect(safeHelpUrl(42)).toBe('')
    expect(safeHelpUrl(null)).toBe('')
    expect(safeHelpUrl(undefined)).toBe('')
    expect(safeHelpUrl({ toString: () => `${HELP_ORIGIN}/rules` })).toBe('')
  })
})

describe('toStoredViolations', () => {
  const fromPage = (helpUrl: string): Array<{ helpUrl: string }> =>
    toStoredViolations([{
      ruleId: 'r', impact: 'critical', description: 'd', helpUrl,
      nodes: [{ target: ['img'], html: '<img>' }]
    }])

  it('sanitises what the page returned, on the Node side of page.evaluate', () => {
    // The wiring, not the function. This was inline in `audit()` first, and
    // deleting the sanitiser there changed no test: the unit spec covered the
    // function, and the integration spec drives a page whose real axe only ever
    // produces trusted links, so neither could see it go.
    expect(fromPage('https://evil.example/phish')[0]?.helpUrl).toBe('')
  })

  it('keeps a genuine documentation link', () => {
    expect(fromPage(`${HELP_ORIGIN}/rules/axe/4.12/image-alt`)[0]?.helpUrl)
      .toBe(`${HELP_ORIGIN}/rules/axe/4.12/image-alt`)
  })

  it('still narrows the impact', () => {
    expect(toStoredViolations([{
      ruleId: 'r', impact: 'nonsense', description: 'd',
      helpUrl: `${HELP_ORIGIN}/rules`, nodes: []
    }])[0]?.impact).toBeNull()
  })
})
