import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const styles = readFileSync('src/styles.css', 'utf8');

const luminance = (hex: string): number => {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  if (channels === undefined) {
    throw new Error(`Expected a six-digit hex colour, received ${hex}`);
  }

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
};

const contrast = (foreground: string, background: string): number => {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
};

describe('the application colour contract', () => {
  it('keeps text on the light accent solid above WCAG AA', () => {
    const onSolid = styles.match(/--lat-accent-on-solid:\s*(#[\da-f]{6})/i)?.[1];

    expect(onSolid).toBeDefined();
    expect(contrast(onSolid!, '#6a9b00')).toBeGreaterThanOrEqual(4.5);
  });

  it('loads the app sheet after the tokens it corrects', () => {
    // Both declare `--lat-accent-on-solid` at `:root`, so the later import
    // wins. Ahead of them, the correction above is simply overwritten.
    const main = readFileSync('src/main.tsx', 'utf8');

    expect(main.indexOf("import './styles.css'")).toBeGreaterThan(main.indexOf("lattice-tokens/lattice.css'"));
    expect(main.indexOf("import './styles.css'")).toBeGreaterThan(main.indexOf("lattice-react/styles.css'"));
  });

  it('uses the high-contrast text semantic for link buttons', () => {
    expect(styles).toContain(".lat-button[data-variant='link'] {\n  color: var(--lat-text);\n}");
  });
});
