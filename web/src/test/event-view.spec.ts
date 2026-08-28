import {describe, expect, it} from 'vitest';

const proxyInit = (values: Record<string, unknown>): PointerEventInit =>
  new Proxy({}, {get: (_target, key: string) => values[key]}) as PointerEventInit;

describe('constructing a UI event with the host window as its view', () => {
  it('is accepted by PointerEvent', () => {
    expect(() => new PointerEvent('click', {view: window})).not.toThrow();
  });

  it('is accepted by MouseEvent', () => {
    expect(() => new MouseEvent('click', {view: window})).not.toThrow();
  });

  it('is accepted by UIEvent', () => {
    expect(() => new UIEvent('click', {view: window})).not.toThrow();
  });

  it('keeps every other member of the init', () => {
    const event = new PointerEvent('click', {view: window, pointerId: 7, pointerType: 'mouse', composed: true});

    expect(event.pointerId).toBe(7);
    expect(event.pointerType).toBe('mouse');
    expect(event.composed).toBe(true);
  });

  it('reads an init that answers property gets and owns no keys', () => {
    const event = new PointerEvent('click', proxyInit({view: window, pointerId: -1, pointerType: 'pen'}));

    expect(event.pointerId).toBe(-1);
    expect(event.pointerType).toBe('pen');
  });

  it('leaves an init without a view untouched', () => {
    const event = new PointerEvent('click', {pointerId: 3});

    expect(event.view).toBeNull();
    expect(event.pointerId).toBe(3);
  });

  it('reads the view once, as the constructor would', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const inner = frame.contentWindow;
    let reads = 0;
    const init = {
      get view(): Window | null {
        reads += 1;
        return inner;
      },
    };

    const event = new PointerEvent('click', init);

    expect(event.view).toBe(inner);
    expect(reads).toBe(1);
    frame.remove();
  });

  it('leaves an init whose view is not the host global alone', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const inner = frame.contentWindow;
    const event = new PointerEvent('click', {view: inner});

    expect(event.view).toBe(inner);
    frame.remove();
  });

  it('still refuses a constructor call with no type', () => {
    const Bare = UIEvent as unknown as new () => UIEvent;

    expect(() => new Bare()).toThrow(/1 argument required/);
  });

  it('keeps arguments past the init', () => {
    const event = Reflect.construct(PointerEvent, ['click', {view: window}, 'ignored']);

    expect(event.type).toBe('click');
  });

  it('accepts a frozen init', () => {
    const event = new PointerEvent('click', Object.freeze({view: window, pointerId: 4}));

    expect(event.view).toBeNull();
    expect(event.pointerId).toBe(4);
  });

  it('still dispatches to a listener', () => {
    const button = document.createElement('button');
    document.body.append(button);
    let seen = 0;
    button.addEventListener('click', () => {
      seen += 1;
    });

    button.dispatchEvent(new PointerEvent('click', {view: window, bubbles: true}));

    expect(seen).toBe(1);
    button.remove();
  });
});
