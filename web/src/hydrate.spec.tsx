import {act} from '@testing-library/react';
import {renderToString} from 'react-dom/server';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mountApp, mountWhenRouterReady} from './hydrate';

const Tree = (): React.JSX.Element => <p>hello</p>;

const containerWith = (prerendered: string | null): HTMLElement => {
  const container = document.createElement('div');
  if (prerendered !== null) {
    container.dataset.prerendered = prerendered;
    container.innerHTML = renderToString(<Tree />);
  }
  document.body.append(container);
  return container;
};

describe('mountApp', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reuses prerendered markup when it was rendered for this path', () => {
    const container = containerWith('/');
    const before = container.firstElementChild;

    act(() => {
      mountApp(container, <Tree />, '/');
    });

    // The same DOM node, not a replacement: that is what hydration means, and
    // asserting on text alone would pass either way.
    expect(container.firstElementChild).toBe(before);
  });

  it('reuses prerendered markup when the pathname differs only by a trailing slash', () => {
    // `dist/signup/index.html` is what a host serves at BOTH `/signup` and
    // `/signup/` - the same file. An exact-string stamp comparison would miss
    // the trailing-slash form and fall back to a client render for a page that
    // was, in fact, prerendered for it.
    const container = containerWith('/signup');
    const before = container.firstElementChild;

    act(() => {
      mountApp(container, <Tree />, '/signup/');
    });

    expect(container.firstElementChild).toBe(before);
  });

  it('discards markup prerendered for a different path', () => {
    // A host serving the landing shell for every route. React would throw the
    // markup away regardless; clearing first stops it hydrating into it.
    const container = containerWith('/');
    const before = container.firstElementChild;

    act(() => {
      mountApp(container, <Tree />, '/dashboard');
    });

    expect(container.firstElementChild).not.toBe(before);
    expect(container.textContent).toBe('hello');
  });

  it('client-renders when nothing was prerendered', () => {
    const container = containerWith(null);

    act(() => {
      mountApp(container, <Tree />, '/');
    });

    expect(container.textContent).toBe('hello');
  });
});

describe('mountWhenRouterReady', () => {
  it('waits to mount matching prerendered markup until a lazy router is ready', () => {
    let subscriber: ((state: {initialized: boolean}) => void) | undefined;
    const unsubscribe = vi.fn();
    const router = {
      state: {initialized: false},
      subscribe: vi.fn((next: (state: {initialized: boolean}) => void) => {
        subscriber = next;
        return unsubscribe;
      }),
    };
    const mount = vi.fn();

    mountWhenRouterReady(true, router, mount);

    expect(mount).not.toHaveBeenCalled();
    expect(router.subscribe).toHaveBeenCalledTimes(1);

    router.state.initialized = true;
    subscriber?.(router.state);
    subscriber?.(router.state);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('catches readiness that arrives between the initial check and subscription', () => {
    const state = {initialized: false};
    const unsubscribe = vi.fn();
    const router = {
      state,
      subscribe: vi.fn(() => {
        state.initialized = true;
        return unsubscribe;
      }),
    };
    const mount = vi.fn();

    mountWhenRouterReady(true, router, mount);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('mounts nonmatching prerendered markup immediately so its fallback remains available', () => {
    const router = {state: {initialized: false}, subscribe: vi.fn()};
    const mount = vi.fn();

    mountWhenRouterReady(false, router, mount);

    expect(router.subscribe).not.toHaveBeenCalled();
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('mounts an initialized error state immediately', () => {
    const router = {state: {initialized: true}, subscribe: vi.fn()};
    const mount = vi.fn();

    mountWhenRouterReady(true, router, mount);

    expect(router.subscribe).not.toHaveBeenCalled();
    expect(mount).toHaveBeenCalledTimes(1);
  });
});
