import {VisuallyHidden} from '@chameleon-labs/lattice-react';

/**
 * A value a run never produced.
 *
 * An em dash alone is announced as "dash" or as nothing at all, depending on
 * the screen reader and its punctuation setting, so the sentence carries the
 * meaning and the glyph carries the column.
 */
export const AbsentValue = (): React.JSX.Element => (
  <>
    <VisuallyHidden>Not recorded</VisuallyHidden>
    <span aria-hidden="true">—</span>
  </>
);
