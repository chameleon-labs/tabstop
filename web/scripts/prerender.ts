import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
// Type-only: erased at runtime, so this does not require `dist-ssr/` to exist
// for `tsc` to resolve it, unlike a value import of the built bundle would.
import type * as EntryServer from '../src/entry-server.tsx';
// The real extensions, because Node runs this file as TypeScript. See
// `tsconfig.scripts.json`, which is what lets the compiler read them too.
import {type BuildManifest, stylesheetsFor} from '../src/prerender/assets.ts';
import {outputFor, PRERENDER_PAGES, type PrerenderedPage} from '../src/prerender/paths.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const SKELETON_CSS = join(HERE, '..', 'src', 'screens', 'components', 'RouteSkeleton', 'route-skeleton.css');
const APP_CSS = join(HERE, '..', 'src', 'styles.css');
const require = createRequire(import.meta.url);

/**
 * Both public, session-free routes are made entirely from compile-time
 * constants. Every other route needs a session or runtime data and therefore
 * remains an app-shell response.
 */
const main = async (): Promise<void> => {
  // Loaded dynamically, and only at runtime: `scripts/prerender.ts` runs after
  // `vite build --ssr` has produced `dist-ssr/entry-server.js`, but `tsc` runs
  // before it exists. A non-literal specifier keeps TS from trying to resolve
  // the file at all, so the import above supplies the types instead.
  const bundle = pathToFileURL(join(HERE, '..', 'dist-ssr', 'entry-server.js')).href;
  const {injectAppShell, injectMarkup, render, assertBuildOutput} = (await import(bundle)) as typeof EntryServer;

  const template = await readFile(join(DIST, 'index.html'), 'utf8');
  // Which chunk owns which stylesheet. The template links the entry's CSS and
  // nothing else, so a lazy route's own styles are only discoverable here.
  const manifest: BuildManifest = JSON.parse(await readFile(join(DIST, '.vite', 'manifest.json'), 'utf8'));

  // Written BEFORE index.html is overwritten, since it is that same file with
  // a boot skeleton in it. This is what the host serves for every
  // non-prerendered path.
  const appHtml = injectAppShell(
    template,
    await readFile(SKELETON_CSS, 'utf8'),
    await readFile(APP_CSS, 'utf8'),
    await readFile(require.resolve('@chameleon-labs/lattice-tokens/lattice.css'), 'utf8'),
  );
  await writeFile(join(DIST, 'app.html'), appHtml);

  const pages = PRERENDER_PAGES.map((page: PrerenderedPage) => ({
    page,
    stylesheets: page.entry === undefined ? [] : stylesheetsFor(manifest, page.entry),
  }));

  for (const {page, stylesheets} of pages) {
    const html = await render(page.path);
    const output = outputFor(DIST, page.path);

    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, injectMarkup(template, page, html, stylesheets));

    console.log(`[prerender] ${page.path} -> ${output.slice(DIST.length + 1)}`);
  }

  // Checked against the FILESYSTEM, not against what the code above meant to
  // do - the failure this guards against is a write that silently did not
  // happen, which reading back every page we actually wrote is the only way
  // to catch.
  const writtenAppHtml = await readFile(join(DIST, 'app.html'), 'utf8').catch(() => '');
  const writtenOutputs = await Promise.all(
    pages.map(async ({page, stylesheets}) => {
      const output = outputFor(DIST, page.path);
      const exists = existsSync(output);
      return {page, stylesheets, exists, html: exists ? await readFile(output, 'utf8') : ''};
    }),
  );
  const writtenIndex = writtenOutputs.find(({page}) => page.path === '/')?.html ?? '';
  assertBuildOutput(writtenAppHtml, writtenIndex, writtenOutputs);
};

// A prerender that fails must fail the BUILD. Emitting the empty shell and
// carrying on degrades exactly back to a blank landing page, which is the one
// regression nobody would notice for months.
//
// `process.exitCode`, not `process.exit()`: the latter tears the process down
// immediately, before stderr - a pipe in CI, not a TTY - has necessarily
// flushed, so the one message that explains the failure can be truncated.
// Setting the code and letting `main()`'s rejection finish unwinding lets
// Node exit on its own once the event loop is empty.
main().catch((error: unknown) => {
  console.error('[prerender] failed:', error);
  process.exitCode = 1;
});
