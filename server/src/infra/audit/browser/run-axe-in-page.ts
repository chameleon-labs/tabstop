/**
 * What crosses back from the page.
 *
 * Declared here rather than in the auditor because this is the side that
 * produces it, and the auditor consumes it through this unit's generated
 * declarations. `impact` is a plain string on this side: narrowing it to the
 * domain's `Impact` happens in Node, on values that came from a realm where
 * every global is replaceable.
 */
export type EvaluatedResult = {
  axeVersion: string;
  violations: Array<{
    ruleId: string;
    impact: string | null;
    description: string;
    helpUrl: string;
    nodes: Array<{target: string[]; html: string}>;
  }>;
};

/**
 * The engine, injected by `page.addScriptTag` before this runs.
 *
 * Declared rather than imported, and typed through an inline `import type` so
 * this file has no import statement at all. `axe-core` is a devDependency used
 * for its types only; a real import would fail at runtime in the page and
 * break the serialisation this function depends on.
 */
declare const axe: typeof import('axe-core') | undefined;

/**
 * Runs in the BROWSER.
 *
 * `page.evaluate` serialises this function and evaluates the source in the
 * audited page, so it may not reference anything in this module - no imports,
 * no module-scope constants, no helpers. That constraint is what makes moving
 * it into its own file safe rather than cosmetic: everything it needs it
 * reads off the page's own globals.
 *
 * The shape checks are NOT redundant with the types. `axe-core`'s types
 * describe the engine we ship; this executes in a realm where `axe` is
 * whatever the page left on `globalThis` by the time the script tag ran. The
 * types make the contract explicit and the checks verify the page honoured
 * it - the assertion the old `as unknown as` cast only claimed (#38).
 */
export const runAxeInPage = async (): Promise<EvaluatedResult> => {
  // `typeof` rather than `axe === undefined`: on a page that never got the
  // script tag the identifier is not merely unset but UNDECLARED, and reading
  // it directly throws a ReferenceError before this check can run. `typeof` is
  // the one operator that tolerates that, so the failure below stays the
  // deliberate, classifiable one.
  if (typeof axe === 'undefined' || typeof axe.run !== 'function') {
    // Wording matters: the classifier matches this as a permanent engine
    // failure, so the user is told the engine could not run rather than
    // seeing three retries of an unrecognised error.
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
      // NOT sanitised here. This function runs inside the audited page, where
      // `URL` is as replaceable as `axe` - see `help-url.ts`. The value crosses
      // back to Node raw and is checked there.
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        // axe does not always hand back a flat list of selectors: a node
        // inside shadow DOM arrives as a NESTED array, verified as
        // [["#host","img"]]. Flattening here keeps `string[]` true all the way
        // down, and ' >>> ' is Playwright's own shadow-piercing notation so
        // the result still reads as a selector path.
        target: node.target.map((entry) => (Array.isArray(entry) ? entry.join(' >>> ') : entry)),
        html: node.html,
      })),
    })),
  };
};
