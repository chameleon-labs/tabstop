import {readFileSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Plugin} from 'vite';
import {injectAppShell} from './inject.ts';
import {servesAppShell} from './paths.ts';

export type BootCss = {
  skeleton: string;
  app: string;
  lattice: string;
};

const sourceFile = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

export const readBootCss = (): BootCss => ({
  skeleton: sourceFile('../screens/components/RouteSkeleton/route-skeleton.css'),
  app: sourceFile('../styles.css'),
  lattice: readFileSync(createRequire(import.meta.url).resolve('@chameleon-labs/lattice-tokens/lattice.css'), 'utf8'),
});

export const servedFromDisk = (outDir: string, pathname: string): boolean => {
  let file;
  try {
    file = resolve(outDir, `.${decodeURI(pathname)}`);
  } catch {
    return false;
  }

  if (file !== outDir && !file.startsWith(`${outDir}/`)) {
    return false;
  }

  return statSync(file, {throwIfNoEntry: false})?.isFile() === true;
};

export const bootShellPlugin = (bootCss: () => BootCss = readBootCss): Plugin => ({
  name: 'tabstop:boot-skeleton',
  apply: 'serve',
  transformIndexHtml: {
    order: 'post',
    handler: (html, ctx) => {
      if (!servesAppShell(ctx.originalUrl ?? '/')) {
        return html;
      }

      const css = bootCss();

      return injectAppShell(html, css.skeleton, css.app, css.lattice);
    },
  },
  configurePreviewServer: (server) => {
    const outDir = resolve(server.config.root, server.config.build.outDir);

    server.middlewares.use((req, _res, next) => {
      const path = (req.url ?? '/').split('?')[0]!;
      if (servesAppShell(path) && !servedFromDisk(outDir, path)) {
        req.url = '/app.html';
      }
      next();
    });
  },
});
