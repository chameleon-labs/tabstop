import {VisuallyHidden} from '@chameleon-labs/lattice-react';

export const AbsentValue = (): React.JSX.Element => (
  <>
    <VisuallyHidden>Not recorded</VisuallyHidden>
    <span aria-hidden="true">—</span>
  </>
);
