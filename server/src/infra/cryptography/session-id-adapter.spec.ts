import {describe, expect, it} from 'vitest';
import {SessionIdAdapter} from './session-id-adapter.js';

describe('SessionIdAdapter', () => {
  it('generates 64 hex characters, distinct on every call', () => {
    const sut = new SessionIdAdapter();

    const first = sut.generate();

    // 256 bits, hex-encoded so the cookie needs no percent-escaping.
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(sut.generate());
  });
});
