import {act, render, screen} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {DocSectionDescriptor} from '../../sections';
import {SectionNav} from './index';

const SECTIONS: readonly DocSectionDescriptor[] = [
  {id: 'purpose', label: 'Purpose'},
  {id: 'inputs', label: 'Inputs'},
  {id: 'weights', label: 'Weights'},
  {id: 'normalization', label: 'Normalization'},
  {id: 'severity', label: 'Severity'},
  {id: 'deductions', label: 'Deductions'},
  {id: 'caps', label: 'Caps'},
  {id: 'examples', label: 'Examples'},
  {id: 'references', label: 'References'},
];

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  elements: Element[];
  options: IntersectionObserverInit;
  disconnect: ReturnType<typeof vi.fn>;
};

const observerRecords: ObserverRecord[] = [];

class ControlledIntersectionObserver {
  readonly disconnect = vi.fn();
  readonly elements: Element[] = [];

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {
    observerRecords.push({callback, elements: this.elements, options, disconnect: this.disconnect});
  }

  observe = (element: Element): void => {
    this.elements.push(element);
  };

  takeRecords = (): IntersectionObserverEntry[] => [];
}

const renderWithSections = () =>
  render(
    <>
      <SectionNav sections={SECTIONS} />
      {SECTIONS.map(({id, label}) => (
        <section key={id} id={id} aria-label={label} />
      ))}
    </>,
  );

afterEach(() => {
  observerRecords.length = 0;
  vi.unstubAllGlobals();
});

describe('SectionNav', () => {
  it('follows the currently intersecting document section and disconnects on unmount', () => {
    vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver);

    const {unmount} = renderWithSections();
    const links = screen.getAllByRole('link');
    const [observer] = observerRecords;

    if (observer === undefined) {
      throw new Error('SectionNav did not create an observer');
    }

    expect(links).toHaveLength(9);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#purpose',
      '#inputs',
      '#weights',
      '#normalization',
      '#severity',
      '#deductions',
      '#caps',
      '#examples',
      '#references',
    ]);
    expect(links[0]).toHaveAttribute('aria-current', 'location');
    expect(observer.options).toEqual({rootMargin: '-20% 0px -70% 0px'});
    expect(observer.elements.map((element) => element.id)).toEqual([
      'purpose',
      'inputs',
      'weights',
      'normalization',
      'severity',
      'deductions',
      'caps',
      'examples',
      'references',
    ]);

    act(() =>
      observer.callback(
        [{isIntersecting: true, target: document.getElementById('weights')!} as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );

    expect(links[0]).not.toHaveAttribute('aria-current');
    expect(links[2]).toHaveAttribute('aria-current', 'location');

    unmount();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps the first native anchor current without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    renderWithSections();

    const links = screen.getAllByRole('link');

    expect(links[0]).toHaveAttribute('aria-current', 'location');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '#purpose',
      '#inputs',
      '#weights',
      '#normalization',
      '#severity',
      '#deductions',
      '#caps',
      '#examples',
      '#references',
    ]);
  });

  it('marks the final section current when the viewport reaches the document bottom', () => {
    vi.stubGlobal('IntersectionObserver', ControlledIntersectionObserver);
    vi.stubGlobal('scrollY', 900);
    vi.stubGlobal('innerHeight', 100);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(1000);

    renderWithSections();
    const [observer] = observerRecords;

    if (observer === undefined) {
      throw new Error('SectionNav did not create an observer');
    }

    act(() =>
      observer.callback(
        [{isIntersecting: true, target: document.getElementById('examples')!} as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );

    expect(screen.getByRole('link', {name: 'References'})).toHaveAttribute('aria-current', 'location');
  });
});
