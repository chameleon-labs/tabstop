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
