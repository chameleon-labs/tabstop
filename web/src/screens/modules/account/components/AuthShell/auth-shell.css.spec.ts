import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const styles = readFileSync('src/screens/modules/account/components/AuthShell/auth-shell.css', 'utf8');
const ledger: unknown = JSON.parse(
  readFileSync('node_modules/@chameleon-labs/lattice-tokens/dist/contrast-ledger.json', 'utf8'),
);

const selectorColor = (selector: string): string | undefined => {
  const escaped = selector.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1];

  return body?.match(/(?:^|;)\s*color:\s*var\((--lat-[^)]+)\)/s)?.[1];
};

const colorPair = (name: string): {text: string; background: string} => {
  if (!Array.isArray(ledger)) {
    throw new Error('Expected the Lattice contrast ledger to be an array');
  }

  for (const value of ledger) {
    if (
      typeof value === 'object' &&
      value !== null &&
      'name' in value &&
      value.name === name &&
      'text' in value &&
      typeof value.text === 'string' &&
      'background' in value &&
      typeof value.background === 'string'
    ) {
      return {text: value.text, background: value.background};
    }
  }

  throw new Error(`Missing contrast ledger entry: ${name}`);
};

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

const contrast = ({text, background}: {text: string; background: string}): number => {
  const textLuminance = luminance(text);
  const backgroundLuminance = luminance(background);
  return (Math.max(textLuminance, backgroundLuminance) + 0.05) / (Math.min(textLuminance, backgroundLuminance) + 0.05);
};

describe('AuthShell colours', () => {
  it.each([
    '.auth-page',
    '.auth-page__brand',
    '.auth-page__brand:hover',
    '.auth-page__subtitle',
    '.auth-page__footer',
    '.auth-page__footer a',
    '.auth-page__footer a:hover',
  ])('uses the readable text semantic for %s', (selector) => {
    expect(selectorColor(selector)).toBe('--lat-text');
  });

  it.each(['light text on bg', 'dark text on bg'])('keeps %s at WCAG AA', (entry) => {
    expect(contrast(colorPair(entry))).toBeGreaterThanOrEqual(4.5);
  });
});
