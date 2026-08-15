import {useEffect, useState} from 'react';
import type {DocSectionDescriptor} from '../../sections';
import './section-nav.css';

export type SectionNavProps = {sections: readonly DocSectionDescriptor[]};

export const SectionNav = ({sections}: SectionNavProps): React.JSX.Element => {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          document.documentElement.scrollHeight > window.innerHeight &&
          Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight
        ) {
          setActiveId(sections[sections.length - 1]?.id ?? '');
          return;
        }

        const active = entries.find((entry) => entry.isIntersecting);
        if (active !== undefined) {
          setActiveId(active.target.id);
        }
      },
      {rootMargin: '-20% 0px -70% 0px'},
    );

    for (const {id} of sections) {
      const section = document.getElementById(id);
      if (section !== null) {
        observer.observe(section);
      }
    }

    return (): void => observer.disconnect();
  }, [sections]);

  return (
    <nav className="section-nav" aria-label="Score formula sections">
      <p className="section-nav__label">On this page</p>
      <ul className="section-nav__list">
        {sections.map(({id, label}) => (
          <li key={id}>
            <a className="section-nav__link" href={`#${id}`} aria-current={activeId === id ? 'location' : undefined}>
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
};
