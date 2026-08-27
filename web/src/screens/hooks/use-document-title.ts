import {useEffect} from 'react';
import {documentTitleSet} from '@/a11y/announce';

export const SITE_NAME = 'tabstop';

export const useDocumentTitle = (title: string): void => {
  useEffect(() => {
    document.title = title === '' ? SITE_NAME : `${title} · ${SITE_NAME}`;
    documentTitleSet();
  });
};
