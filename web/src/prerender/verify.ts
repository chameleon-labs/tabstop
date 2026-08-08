/**
 * Fails the build when the write `main()` depends on did not actually happen.
 *
 * `_redirects` sends every non-prerendered path to `/app.html` (see the
 * comment there), so a build that silently stopped writing it would leave
 * every route but `/` 404ing on the host - while `pnpm build` still exited 0,
 * since neither `vite build` nor a plain `writeFile` call fails for that. This
 * is the one check standing between that and CI staying green.
 */
export const assertBuildOutput = (appHtmlExists: boolean, indexHtml: string): void => {
  if (!appHtmlExists) {
    throw new Error('dist/app.html was not written; every route but / would 404 on the host');
  }

  if (!indexHtml.includes('data-prerendered')) {
    throw new Error('dist/index.html has no data-prerendered stamp; the landing page was not prerendered');
  }
};
