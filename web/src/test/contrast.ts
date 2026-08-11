import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

/**
 * Contrast between two Lattice tokens, read from the shipped stylesheet.
 * A contrast failure is invisible to every other kind of assertion.
 */
export type Theme = 'light' | 'dark';

const tokenCss = (): string => readFileSync(require.resolve('@chameleon-labs/lattice-tokens/lattice.css'), 'utf8');

/** The declarations inside one selector's block, as a name → value map. */
const blockOf = (css: string, selector: string): Map<string, string> => {
  const index = css.indexOf(selector);
  if (index === -1) {
    throw new Error(`no ${selector} block in the token stylesheet`);
  }
  const open = css.indexOf('{', index);
  const close = css.indexOf('}', open);
  const declarations = new Map<string, string>();

  for (const [, name, value] of css.slice(open, close).matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
    declarations.set(name!, value!.trim());
  }

  return declarations;
};

/** Follows the alias chain: one hop returns another `var(...)`, not a colour. */
const resolve = (name: string, theme: Map<string, string>, root: Map<string, string>): string => {
  let value = theme.get(name) ?? root.get(name);

  for (let hops = 0; value !== undefined && value.startsWith('var(') && hops < 10; hops += 1) {
    const alias = /var\((--[a-z0-9-]+)/.exec(value)?.[1];
    if (alias === undefined) {
      break;
    }
    value = theme.get(alias) ?? root.get(alias);
  }

  if (value === undefined) {
    throw new Error(`${name} resolves to nothing`);
  }
  return value;
};

/** Linear-light sRGB, unclamped, so an out-of-gamut colour is visible as such. */
const oklchToLinearSrgb = (lightness: number, chroma: number, hue: number): [number, number, number] => {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);

  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const relativeLuminance = (value: string): number => {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (match === null) {
    throw new Error(`not an oklch() colour: ${value}`);
  }

  const [red, green, blue] = oklchToLinearSrgb(Number(match[1]), Number(match[2]), Number(match[3])).map((channel) =>
    Math.min(1, Math.max(0, channel)),
  ) as [number, number, number];

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

/** Named for what a stylesheet writes, so a failure names the wrong pairing. */
export const contrastBetween = (foreground: string, background: string, theme: Theme): number => {
  const css = tokenCss();
  const root = blockOf(css, ':root');
  const themed = blockOf(css, `[data-lat-theme='${theme}']`);

  const first = relativeLuminance(resolve(foreground, themed, root));
  const second = relativeLuminance(resolve(background, themed, root));

  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};
