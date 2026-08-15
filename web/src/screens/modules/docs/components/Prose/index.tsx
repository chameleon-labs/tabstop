import type {ComponentPropsWithoutRef} from 'react';
import './prose.css';

export type ProseProps = ComponentPropsWithoutRef<'p'>;

export const Prose = ({className, ...props}: ProseProps): React.JSX.Element => (
  <p className={['docs-prose', className].filter(Boolean).join(' ')} {...props} />
);
