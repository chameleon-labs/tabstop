import {SKELETON_BLOCKS, SKELETON_SHAPES, type SkeletonShape} from '../screens/components/RouteSkeleton/shapes.ts';

const DARK_STAMP = "[data-lat-theme='dark']";
const DARK_SYSTEM = ":root:not([data-lat-theme='light'])";

export const tokensReadBy = (css: string): string[] => [
  ...new Set([...css.matchAll(/var\((--lat-[a-z0-9-]+)/g)].map(([, name]) => name!)),
];

const blockAt = (css: string, openBraceIndex: number): string => {
  let depth = 0;
  for (let index = openBraceIndex; index < css.length; index += 1) {
    if (css[index] === '{') {
      depth += 1;
    } else if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) {
        return css.slice(openBraceIndex + 1, index);
      }
    }
  }
  throw new Error('unbalanced braces while reading the design system sheet');
};

const declarationsIn = (css: string): Map<string, string> =>
  new Map([...css.matchAll(/(--lat-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name!, value!.trim()]));

const scopes = (css: string): {light: Map<string, string>; dark: Map<string, string>} => {
  const at = css.indexOf(DARK_STAMP);
  if (at === -1) {
    throw new Error(`the design system sheet has no ${DARK_STAMP} block, so no dark value can be inlined`);
  }

  const light = declarationsIn(css.slice(0, at));
  const dark = new Map(light);
  for (const [name, value] of declarationsIn(blockAt(css, css.indexOf('{', at)))) {
    dark.set(name, value);
  }

  return {light, dark};
};

const resolve = (name: string, scope: Map<string, string>, seen = new Set<string>()): string => {
  const value = scope.get(name);
  if (value === undefined) {
    throw new Error(`the design system sheet declares no ${name}, so the boot skeleton cannot inline it`);
  }
  if (seen.has(name)) {
    throw new Error(`${name} resolves through itself`);
  }
  seen.add(name);

  return value.replace(/var\((--lat-[a-z0-9-]+)\)/g, (_, referenced: string) => resolve(referenced, scope, seen));
};

const declare = (names: readonly string[], scope: Map<string, string>): string =>
  names.map((name) => `${name}: ${resolve(name, scope)};`).join('');

export const bootTokenCss = (latticeCss: string, names: readonly string[]): string => {
  const {light, dark} = scopes(latticeCss);
  const changed = names.filter((name) => resolve(name, dark) !== resolve(name, light));

  const blocks = [`:root{${declare(names, light)}}`];
  if (changed.length > 0) {
    blocks.push(`${DARK_STAMP}{${declare(changed, dark)}}`);
    blocks.push(`@media (prefers-color-scheme: dark){${DARK_SYSTEM}{${declare(changed, dark)}}}`);
  }

  return blocks.join('');
};

export const ruleFor = (css: string, selector: string): string => {
  const at = css.indexOf(selector);
  const brace = at === -1 ? -1 : css.indexOf('{', at + selector.length);
  if (at === -1 || brace === -1) {
    throw new Error(`the application sheet no longer declares ${selector}, so the boot skeleton cannot inline it`);
  }

  return `${selector}{${blockAt(css, brace)}}`;
};

export const bootShapeScript = (): string => {
  const table = SKELETON_SHAPES.map(([pattern, shape]) => `[${String(pattern)},'${shape}']`).join(',');

  return `function __bootShape(p){var t=[${table}];var s=p.length>1&&p.slice(-1)==='/'?p.slice(0,-1):p;for(var i=0;i<t.length;i++){if(t[i][0].test(s))return t[i][1]}return 'generic'}`;
};

const span = (name: string): string => `<span class="route-skeleton__block" data-block="${name}"></span>`;

export const bootSkeletonMarkup = (shape: SkeletonShape): string => {
  const {head, body} = SKELETON_BLOCKS[shape];

  return (
    `<div class="route-skeleton" data-shape="${shape}" aria-busy="true">` +
    `<p class="visually-hidden">Loading…</p>` +
    `<div class="route-skeleton__blocks" aria-hidden="true">` +
    `<span class="route-skeleton__head">${head.map(span).join('')}</span>` +
    `${body.map(span).join('')}` +
    `</div></div>`
  );
};
