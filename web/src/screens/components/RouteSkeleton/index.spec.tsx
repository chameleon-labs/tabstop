import {render, screen} from '@testing-library/react';
import {RouterProvider, createMemoryRouter} from 'react-router';
import {describe, expect, it} from 'vitest';
import {RouteSkeleton, skeletonShapeFor} from '.';

const renderAtPath = (path: string): void => {
  render(
    <RouterProvider router={createMemoryRouter([{path: '*', element: <RouteSkeleton />}], {initialEntries: [path]})} />,
  );
};

const skeleton = (): HTMLElement | null => document.querySelector('.route-skeleton');

describe('skeletonShapeFor', () => {
  it.each([
    ['/dashboard', 'dashboard'],
    ['/pages/42', 'detail'],
    ['/login', 'form'],
    ['/signup', 'form'],
    ['/r/2f8c-uuid', 'generic'],
    ['/docs/score-formula', 'generic'],
    ['/', 'generic'],
  ])('reads %s as the %s shape', (path, shape) => {
    expect(skeletonShapeFor(path)).toBe(shape);
  });

  it('ignores a trailing slash, which a host may add before the app ever runs', () => {
    expect(skeletonShapeFor('/dashboard/')).toBe('dashboard');
  });
});

describe('skeletonShapeFor and the router', () => {
  it('matches a path the way the router does, which is without regard to case', () => {
    expect(skeletonShapeFor('/DASHBOARD')).toBe('dashboard');
    expect(skeletonShapeFor('/Login')).toBe('form');
    expect(skeletonShapeFor('/Pages/abc')).toBe('detail');
  });
});

describe('RouteSkeleton', () => {
  it('lays out the shape of the screen the visitor asked for', () => {
    renderAtPath('/dashboard');

    expect(skeleton()).toHaveAttribute('data-shape', 'dashboard');
  });

  it('falls back to a plain shape on a screen it has no layout for', () => {
    renderAtPath('/r/2f8c-uuid');

    expect(skeleton()).toHaveAttribute('data-shape', 'generic');
  });

  it('says it is loading once, and keeps the blocks out of the way', () => {
    renderAtPath('/dashboard');

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(document.querySelector('.route-skeleton__blocks')).toHaveAttribute('aria-hidden', 'true');
  });
});
