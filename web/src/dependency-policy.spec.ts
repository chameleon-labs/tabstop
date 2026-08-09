// @vitest-environment node
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';

interface PackageManifest {
  dependencies?: Record<string, string>;
}

describe('the dependency release-age policy', () => {
  it('records explicit trust for each pinned Lattice release', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest;
    const workspace = readFileSync(join('..', 'pnpm-workspace.yaml'), 'utf8');
    const lattice = Object.entries(manifest.dependencies ?? {}).filter(([name]) =>
      name.startsWith('@chameleon-labs/lattice-'),
    );

    expect(lattice.length).toBeGreaterThan(0);
    for (const [name, version] of lattice) {
      expect(workspace).toContain(`- '${name}@${version}'`);
    }
  });
});
