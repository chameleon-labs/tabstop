import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
// Type-only: erased at runtime, so this does not require `dist-ssr/` to exist
// for `tsc` to resolve it, unlike a value import of the built bundle would.
import type * as EntryServer from '../src/entry-server.tsx';
// @ts-expect-error Node runs this TypeScript file directly and needs its extension.
import {outputFor, PRERENDER_PATHS} from '../src/prerender/paths.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');

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
  const {injectMarkup, render, assertBuildOutput} = (await import(bundle)) as typeof EntryServer;

  const template = await readFile(join(DIST, 'index.html'), 'utf8');

  // Written BEFORE index.html is overwritten, since it is that same file
  // untouched. This is what the host serves for every non-prerendered path.
  await writeFile(join(DIST, 'app.html'), template);

  for (const path of PRERENDER_PATHS) {
    const html = await render(path);
    const output = outputFor(DIST, path);

    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, injectMarkup(template, path, html));

    console.log(`[prerender] ${path} -> ${output.slice(DIST.length + 1)}`);
  }

  // Checked against the FILESYSTEM, not against what the code above meant to
  // do - the failure this guards against is a write that silently did not
  // happen, which reading back every page we actually wrote is the only way
  // to catch.
  const appHtmlExists = existsSync(join(DIST, 'app.html'));
  const writtenOutputs = await Promise.all(
    PRERENDER_PATHS.map(async (path) => {
      const output = outputFor(DIST, path);
      const exists = existsSync(output);
      return {path, exists, html: exists ? await readFile(output, 'utf8') : ''};
    }),
  );
  const writtenIndex = writtenOutputs.find(({path}) => path === '/')?.html ?? '';
  assertBuildOutput(appHtmlExists, writtenIndex, writtenOutputs);
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
