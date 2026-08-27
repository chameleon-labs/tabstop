import {useEffect, useRef, useState} from 'react';
import {useLocation} from 'react-router';
import {ANNOUNCE_DELAY_MS, onDocumentTitleSet} from '@/a11y/announce';

export const RouteAnnouncer = (): React.JSX.Element => {
  const {pathname} = useLocation();
  const [announcement, setAnnouncement] = useState('');

  const announcedFor = useRef(pathname);

  useEffect(() => {
    if (announcedFor.current === pathname) {
      return;
    }
    announcedFor.current = pathname;

    setAnnouncement('');

    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = onDocumentTitleSet(() => {
      stop();
      timer = setTimeout(() => {
        setAnnouncement(document.title);
      }, ANNOUNCE_DELAY_MS);
    });

    return (): void => {
      stop();
      clearTimeout(timer);
    };
  }, [pathname]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="visually-hidden">
      {announcement}
    </div>
  );
};
