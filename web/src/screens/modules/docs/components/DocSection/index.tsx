import type {ComponentPropsWithoutRef, ReactNode} from 'react';
import './doc-section.css';

export type DocSectionProps = Omit<ComponentPropsWithoutRef<'section'>, 'id' | 'title' | 'children'> & {
  id: string;
  title: string;
  children: ReactNode;
};

export const DocSection = ({id, title, className, children, ...props}: DocSectionProps): React.JSX.Element => (
  <section id={id} className={['doc-section', className].filter(Boolean).join(' ')} {...props}>
    <h2 className="doc-section__heading">
      {title}
      <a className="doc-section__permalink" href={`#${id}`} aria-label={`Permalink to ${title}`}>
        <span aria-hidden="true">#</span>
      </a>
    </h2>
    <div className="doc-section__body">{children}</div>
  </section>
);
