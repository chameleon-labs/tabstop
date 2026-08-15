export type ManifestChunk = {
  readonly file: string;
  readonly css?: readonly string[];
  readonly imports?: readonly string[];
};

export type BuildManifest = Readonly<Record<string, ManifestChunk>>;

/**
 * Every stylesheet a route needs, as host paths.
 *
 * The whole import graph, not the entry's own `css`: a page's styles are split
 * across every chunk it pulls in, and linking only the first leaves the rest
 * to arrive with the JavaScript.
 */
export const stylesheetsFor = (manifest: BuildManifest, entry: string): string[] => {
  if (manifest[entry] === undefined) {
    throw new Error(`${entry} is not in the build manifest; its stylesheets cannot be linked`);
  }

  const hrefs: string[] = [];
  const visited = new Set<string>();

  const walk = (key: string): void => {
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const chunk = manifest[key];
    if (chunk === undefined) {
      return;
    }

    for (const file of chunk.css ?? []) {
      const href = `/${file}`;
      if (!hrefs.includes(href)) {
        hrefs.push(href);
      }
    }

    for (const imported of chunk.imports ?? []) {
      walk(imported);
    }
  };

  walk(entry);

  return hrefs;
};
