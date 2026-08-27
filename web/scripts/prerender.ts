import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import type * as EntryServer from '../src/entry-server.tsx';
import {type BuildManifest, stylesheetsFor} from '../src/prerender/assets.ts';
import {outputFor, PRERENDER_PAGES, type PrerenderedPage} from '../src/prerender/paths.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const SKELETON_CSS = join(HERE, '..', 'src', 'screens', 'components', 'RouteSkeleton', 'route-skeleton.css');
const APP_CSS = join(HERE, '..', 'src', 'styles.css');
const require = createRequire(import.meta.url);

const main = async (): Promise<void> => {
  const bundle = pathToFileURL(join(HERE, '..', 'dist-ssr', 'entry-server.js')).href;
  const {injectAppShell, injectMarkup, render, assertBuildOutput} = (await import(bundle)) as typeof EntryServer;

  const template = await readFile(join(DIST, 'index.html'), 'utf8');
  const manifest: BuildManifest = JSON.parse(await readFile(join(DIST, '.vite', 'manifest.json'), 'utf8'));

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

main().catch((error: unknown) => {
  console.error('[prerender] failed:', error);
  process.exitCode = 1;
});
