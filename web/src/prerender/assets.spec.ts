import {describe, expect, it} from 'vitest';
import {stylesheetsFor} from './assets';

const ENTRY = 'src/screens/modules/docs/pages/ScoreFormula/index.tsx';

describe('stylesheetsFor', () => {
  it('returns the route chunk’s own stylesheets, as host paths', () => {
    const manifest = {
      [ENTRY]: {file: 'assets/ScoreFormula-abc.js', css: ['assets/ScoreFormula-def.css']},
    };

    expect(stylesheetsFor(manifest, ENTRY)).toEqual(['/assets/ScoreFormula-def.css']);
  });

  it('collects the stylesheets of everything the chunk imports', () => {
    const manifest = {
      [ENTRY]: {file: 'assets/ScoreFormula-abc.js', css: ['assets/ScoreFormula-def.css'], imports: ['_shared-1.js']},
      '_shared-1.js': {file: 'assets/shared-1.js', css: ['assets/shared-1.css'], imports: ['_shared-2.js']},
      '_shared-2.js': {file: 'assets/shared-2.js', css: ['assets/shared-2.css']},
    };

    expect(stylesheetsFor(manifest, ENTRY)).toEqual([
      '/assets/ScoreFormula-def.css',
      '/assets/shared-1.css',
      '/assets/shared-2.css',
    ]);
  });

  it('lists each stylesheet once, however many chunks import it', () => {
    const manifest = {
      [ENTRY]: {file: 'assets/ScoreFormula-abc.js', imports: ['_a.js', '_b.js']},
      '_a.js': {file: 'assets/a.js', css: ['assets/shared.css']},
      '_b.js': {file: 'assets/b.js', css: ['assets/shared.css']},
    };

    expect(stylesheetsFor(manifest, ENTRY)).toEqual(['/assets/shared.css']);
  });

  it('terminates on a cycle in the import graph', () => {
    const manifest = {
      [ENTRY]: {file: 'assets/ScoreFormula-abc.js', imports: ['_a.js']},
      '_a.js': {file: 'assets/a.js', css: ['assets/a.css'], imports: [ENTRY]},
    };

    expect(stylesheetsFor(manifest, ENTRY)).toEqual(['/assets/a.css']);
  });

  it('throws when the entry is not in the manifest', () => {
    expect(() => stylesheetsFor({}, ENTRY)).toThrow(ENTRY);
  });
});
