import { afterEach, describe, expect, it } from 'vitest'
import { runAxeInPage } from './playwright-axe-auditor.js'

/**
 * runAxeInPage is serialised into the browser by page.evaluate, so it reads
 * everything off globalThis and closes over nothing. That is exactly what lets
 * it be driven here against a stand-in global, which is the only way to reach
 * the failure branches - a real page always has axe injected before this runs.
 */
type Stub = { axe?: unknown, document?: unknown }
const globals = globalThis as unknown as Stub

const install = (axe: unknown): void => {
  globals.document = {}
  globals.axe = axe
}

const axeReturning = (result: unknown) => ({ run: async () => result })

const validResult = {
  testEngine: { version: '4.12.1' },
  violations: [{
    id: 'image-alt',
    impact: 'critical',
    description: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
    nodes: [{ target: ['img'], html: '<img>' }]
  }]
}

describe('runAxeInPage', () => {
  afterEach(() => {
    delete globals.axe
    delete globals.document
  })

  it('maps a violation into the repository shape', async () => {
    install(axeReturning(validResult))

    expect(await runAxeInPage()).toEqual({
      axeVersion: '4.12.1',
      violations: [{
        ruleId: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
        nodes: [{ target: ['img'], html: '<img>' }]
      }]
    })
  })

  describe('helpUrl, which the audited page chooses', () => {
    // EVERYTHING in the axe result is attacker-controlled. `window.axe` is
    // injected into a page nobody vetted, and that page can replace the object
    // before it is asked to run - so `helpUrl` is a string the audited site
    // picked. It was stored and served verbatim, becoming the `href` of a link
    // reading "How to fix this" inside an accessibility report, on a share page
    // anybody can send to a colleague.
    const withHelpUrl = async (helpUrl: unknown): Promise<string | undefined> => {
      install(axeReturning({
        testEngine: { version: '4.12.1' },
        violations: [{
          id: 'r', impact: 'critical', description: 'd', helpUrl,
          nodes: [{ target: ['img'], html: '<img>' }]
        }]
      }))
      const result = await runAxeInPage()
      return result.violations[0]?.helpUrl
    }

    it('keeps an ordinary documentation link', async () => {
      expect(await withHelpUrl('https://dequeuniversity.com/rules/axe/4.12/image-alt'))
        .toBe('https://dequeuniversity.com/rules/axe/4.12/image-alt')
    })

    it.each([
      'javascript:alert(document.cookie)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'not a url'
    ])('drops %p rather than storing it', async (helpUrl) => {
      expect(await withHelpUrl(helpUrl)).toBe('')
    })

    it('drops a value that is not a string at all', async () => {
      // `run()` returns whatever the page decided to return. Nothing guarantees
      // the field is even a string.
      expect(await withHelpUrl(42)).toBe('')
      expect(await withHelpUrl(null)).toBe('')
    })
  })

  it('flattens a nested shadow-DOM selector', async () => {
    install(axeReturning({
      testEngine: { version: '4.12.1' },
      violations: [{
        id: 'label', impact: 'critical', description: 'd', helpUrl: 'u',
        nodes: [{ target: [['#host', 'input']], html: '<input>' }]
      }]
    }))

    const result = await runAxeInPage()

    expect(result.violations[0]?.nodes[0]?.target).toEqual(['#host >>> input'])
  })

  it('fails with a classifiable message when the engine is missing', async () => {
    // The cast cannot be removed until #38 gives this its own DOM-typed
    // compilation unit, so it is at least CHECKED: without this the call would
    // be an undefined-property error somewhere downstream, classified as an
    // unrecognised transient failure and retried three times.
    globals.document = {}
    delete globals.axe

    await expect(runAxeInPage()).rejects.toThrow('axe is not defined')
  })

  it('fails when the global is present but is not the engine', async () => {
    install({ notRun: true })

    await expect(runAxeInPage()).rejects.toThrow('axe is not defined')
  })

  it('fails when the engine returns a shape it did not used to', async () => {
    // A silent API change would otherwise surface as `undefined` reaching the
    // database, where axe_version is asserted to be a version string.
    for (const shape of [
      {},
      { testEngine: {}, violations: [] },
      { testEngine: { version: 4 }, violations: [] },
      { testEngine: { version: '4.12.1' } },
      { testEngine: { version: '4.12.1' }, violations: 'nope' }
    ]) {
      install(axeReturning(shape))
      await expect(runAxeInPage()).rejects.toThrow('unrecognised result shape')
    }
  })

  it('closes over nothing, so page.evaluate can serialise it', () => {
    // If this ever referenced a module-scope identifier it would compile and
    // typecheck here, then fail only inside a real browser.
    const source = runAxeInPage.toString()

    expect(source).not.toMatch(/\bIMPACTS\b|\bAXE_PATH\b|\bisImpact\b|\bAUDIT_CONTEXT_OPTIONS\b/)
    expect(source).toContain('globalThis')
  })
})
