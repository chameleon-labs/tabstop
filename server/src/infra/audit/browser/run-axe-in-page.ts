import type * as axeCore from 'axe-core';

export type EvaluatedResult = {
  axeVersion: string;
  violations: {
    ruleId: string;
    impact: string | null;
    description: string;
    helpUrl: string;
    nodes: {target: string[]; html: string}[];
  }[];
};

declare const axe: typeof axeCore | undefined;

export const runAxeInPage = async (): Promise<EvaluatedResult> => {
  if (typeof axe === 'undefined' || typeof axe.run !== 'function') {
    throw new Error('axe is not defined on the page');
  }

  const run = await axe.run(document, {resultTypes: ['violations']});

  if (typeof run?.testEngine?.version !== 'string' || !Array.isArray(run.violations)) {
    throw new Error('axe returned an unrecognised result shape');
  }

  return {
    axeVersion: run.testEngine.version,
    violations: run.violations.map((violation) => ({
      ruleId: violation.id,
      impact: violation.impact ?? null,
      description: violation.description,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target.map((entry) => (Array.isArray(entry) ? entry.join(' >>> ') : entry)),
        html: node.html,
      })),
    })),
  };
};
