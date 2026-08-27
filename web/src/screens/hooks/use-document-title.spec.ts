import {renderHook} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import {SITE_NAME, useDocumentTitle} from './use-document-title';

describe('useDocumentTitle', () => {
  it('suffixes the site name, so a tab says what it is and where it is', () => {
    renderHook(() => {
      useDocumentTitle('Dashboard');
    });

    expect(document.title).toBe(`Dashboard · ${SITE_NAME}`);
  });

  it('uses the site name alone for an empty title', () => {
    renderHook(() => {
      useDocumentTitle('');
    });

    expect(document.title).toBe(SITE_NAME);
  });

  it('follows a title that changes without remounting', () => {
    const {rerender} = renderHook(
      ({title}: {title: string}) => {
        useDocumentTitle(title);
      },
      {initialProps: {title: 'Page'}},
    );

    rerender({title: 'example.com/pricing'});

    expect(document.title).toBe(`example.com/pricing · ${SITE_NAME}`);
  });
});
