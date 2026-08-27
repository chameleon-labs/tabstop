import {afterEach, describe, expect, it} from 'vitest';
import {runAxeInPage} from './browser/run-axe-in-page.js';

type Stub = {axe?: unknown; document?: unknown};
const globals = globalThis as unknown as Stub;

const install = (axe: unknown): void => {
  globals.document = {};
  globals.axe = axe;
};

const axeReturning = (result: unknown) => ({run: () => Promise.resolve(result)});

const validResult = {
  testEngine: {version: '4.12.1'},
  violations: [
    {
      id: 'image-alt',
      impact: 'critical',
      description: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      nodes: [{target: ['img'], html: '<img>'}],
    },
  ],
};

describe('runAxeInPage', () => {
  afterEach(() => {
    delete globals.axe;
    delete globals.document;
  });

  it('maps a violation into the repository shape', async () => {
    install(axeReturning(validResult));

    expect(await runAxeInPage()).toEqual({
      axeVersion: '4.12.1',
      violations: [
        {
          ruleId: 'image-alt',
          impact: 'critical',
          description: 'Images must have alternate text',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
          nodes: [{target: ['img'], html: '<img>'}],
        },
      ],
    });
  });

  it('hands helpUrl back RAW, because this runs in the audited page', async () => {
    install(
      axeReturning({
        testEngine: {version: '4.12.1'},
        violations: [
          {
            id: 'r',
            impact: 'critical',
            description: 'd',
            helpUrl: 'https://evil.example/phish',
            nodes: [{target: ['img'], html: '<img>'}],
          },
        ],
      }),
    );

    const result = await runAxeInPage();

    expect(result.violations[0]?.helpUrl).toBe('https://evil.example/phish');
  });

  it('flattens a nested shadow-DOM selector', async () => {
    install(
      axeReturning({
        testEngine: {version: '4.12.1'},
        violations: [
          {
            id: 'label',
            impact: 'critical',
            description: 'd',
            helpUrl: 'u',
            nodes: [{target: [['#host', 'input']], html: '<input>'}],
          },
        ],
      }),
    );

    const result = await runAxeInPage();

    expect(result.violations[0]?.nodes[0]?.target).toEqual(['#host >>> input']);
  });

  it('fails with a classifiable message when the engine is missing', async () => {
    globals.document = {};
    delete globals.axe;

    await expect(runAxeInPage()).rejects.toThrow('axe is not defined');
  });

  it('fails when the global is present but is not the engine', async () => {
    install({notRun: true});

    await expect(runAxeInPage()).rejects.toThrow('axe is not defined');
  });

  it('fails when the engine returns a shape it did not used to', async () => {
    for (const shape of [
      {},
      {testEngine: {}, violations: []},
      {testEngine: {version: 4}, violations: []},
      {testEngine: {version: '4.12.1'}},
      {testEngine: {version: '4.12.1'}, violations: 'nope'},
    ]) {
      install(axeReturning(shape));
      await expect(runAxeInPage()).rejects.toThrow('unrecognised result shape');
    }
  });

  it('closes over nothing, so page.evaluate can serialise it', () => {
    const source = runAxeInPage.toString();

    expect(source).not.toMatch(/\bIMPACTS\b|\bAXE_PATH\b|\bisImpact\b|\bAUDIT_CONTEXT_OPTIONS\b/);
    expect(source).not.toMatch(/\b(?:require|import)\s*\(/);
    expect(source).not.toMatch(/\bexports\b|\bmodule\b/);
    expect(source).toMatch(/\btypeof axe\b/);
    expect(source).toMatch(/\baxe\.run\(document\b/);
  });
});
