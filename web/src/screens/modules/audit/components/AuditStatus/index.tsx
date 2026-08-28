import {useEffect, useState} from 'react';
import {ANNOUNCE_DELAY_MS} from '@/a11y/announce';

export type AuditStatusProps = {
  message: string | null;
  visibleMessage?: string | null;
};

export const AuditStatus = ({message, visibleMessage}: AuditStatusProps): React.JSX.Element => {
  const [shown, setShown] = useState('');
  const [tracked, setTracked] = useState(message);

  if (tracked !== message) {
    setTracked(message);
    if (message === null) {
      setShown('');
    }
  }

  useEffect(() => {
    if (message === null || message === shown) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setShown(message);
    }, ANNOUNCE_DELAY_MS);
    return (): void => {
      clearTimeout(timer);
    };
  }, [message, shown]);

  const separate = visibleMessage !== undefined;
  return (
    <p className={separate ? 'audit-status' : undefined} role="status" aria-live="polite" aria-atomic="true">
      {separate ? (
        <>
          <span className="audit-status__visual" aria-hidden="true">
            {visibleMessage}
          </span>
          <span className="visually-hidden">{shown}</span>
        </>
      ) : (
        shown
      )}
    </p>
  );
};
