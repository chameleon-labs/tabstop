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
