import {FALLBACK_SHAPE, SKELETON_BLOCKS, type SkeletonShape} from '../screens/components/RouteSkeleton/shapes.ts';
import {bootShapeScript, bootSkeletonMarkup, bootTokenCss, ruleFor, tokensReadBy} from './boot-skeleton.ts';
import type {PrerenderedPage} from './paths.ts';

const ROOT = '<div id="root"></div>';
const TITLE = /<title>[\s\S]*?<\/title>/;
const DESCRIPTION = /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/;
const HEAD_END = '</head>';

export const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const injectMarkup = (
  template: string,
  page: PrerenderedPage,
  html: string,
  stylesheets: readonly string[] = [],
): string => {
  if (!template.includes(ROOT)) {
    throw new Error(`the built index.html no longer contains ${ROOT}; nothing was prerendered`);
  }

  const {path, title, description} = page;
  let output = template;

  if (title !== undefined) {
    if (!TITLE.test(output)) {
      throw new Error(`the built index.html has no <title> to replace, so ${path} would publish no title of its own`);
    }
    output = output.replace(TITLE, () => `<title>${escapeHtml(title)}</title>`);
  }

  if (description !== undefined) {
    if (!DESCRIPTION.test(output)) {
      throw new Error(`the built index.html has no description meta to replace for ${path}`);
    }
    output = output.replace(DESCRIPTION, () => `<meta name="description" content="${escapeHtml(description)}" />`);
  }

  const missing = stylesheets.filter((href) => !output.includes(`href="${href}"`));
  if (missing.length > 0) {
    if (!output.includes(HEAD_END)) {
      throw new Error(`the built index.html has no ${HEAD_END}; ${path} cannot link its route stylesheets`);
    }
    const links = missing.map((href) => `<link rel="stylesheet" crossorigin href="${href}">`).join('');
    output = output.replace(HEAD_END, () => `${links}${HEAD_END}`);
  }

  return output.replace(ROOT, () => `<div id="root" data-prerendered="${path}">${html}</div>`);
};

const ASSET_TAG = /<(script type="module"|link rel="stylesheet")/;

const HEADER_RESERVE = '3.5rem';

const bootOnlyCss =
  'body{background:var(--lat-bg);color:var(--lat-text)}' +
  `#root>.route-skeleton{padding-block-start:calc(${HEADER_RESERVE} + var(--lat-space-8))}` +
  `#root>.route-skeleton[data-shape='form']{min-block-size:100dvh;padding-block-start:calc(${HEADER_RESERVE} + var(--lat-space-16))}`;

const upgradeScript = (): string => {
  const others = (Object.keys(SKELETON_BLOCKS) as SkeletonShape[]).filter((shape) => shape !== FALLBACK_SHAPE);
  const markup = others.map((shape) => `${JSON.stringify(shape)}:${JSON.stringify(bootSkeletonMarkup(shape))}`);

  return (
    `<script>${bootShapeScript()}(function(){var m={${markup.join(',')}};` +
    `var s=__bootShape(location.pathname);var r=document.getElementById("root");` +
    `if(m[s]&&r){r.innerHTML=m[s]}})()</script>`
  );
};

const BLOCKING_SHEET = /<link rel="stylesheet"([^>]*)>/g;

export const injectAppShell = (template: string, skeletonCss: string, appCss: string, latticeCss: string): string => {
  if (!template.includes(ROOT)) {
    throw new Error(`the built index.html no longer contains ${ROOT}; the app shell would paint nothing`);
  }
  if (!ASSET_TAG.test(template)) {
    throw new Error(
      'the built index.html links no module or stylesheet, so the boot styles have nothing to be placed ahead of',
    );
  }

  const reset = ruleFor(appCss, '*');
  const hidden = ruleFor(appCss, '.visually-hidden');
  const boot = `${reset}${skeletonCss}${hidden}${bootOnlyCss}`;
  const css = `${bootTokenCss(latticeCss, tokensReadBy(boot))}${boot}`;

  return template
    .replace(ASSET_TAG, (tag) => `<style>${css}</style>${tag}`)
    .replace(
      BLOCKING_SHEET,
      (_, attributes: string) =>
        `<link rel="preload" as="style"${attributes} onload="this.rel='stylesheet'">` +
        `<noscript><link rel="stylesheet"${attributes}></noscript>`,
    )
    .replace(ROOT, () => `<div id="root">${bootSkeletonMarkup(FALLBACK_SHAPE)}</div>${upgradeScript()}`);
};
