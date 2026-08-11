import {describe, expect, it} from 'vitest';
import {RETURN_TO_KEY, destinationFrom, returnToSearch} from './return-to';

describe('destinationFrom', () => {
  it('keeps an app-local destination including search and hash', () => {
    expect(destinationFrom(returnToSearch('/pages/42?days=30#history'))).toBe('/pages/42?days=30#history');
  });

  it('rejects protocol-relative destinations', () => {
    expect(destinationFrom(returnToSearch('//evil.example/path'))).toBe('/dashboard');
  });

  it('rejects browser-normalized external destinations', () => {
    expect(destinationFrom(returnToSearch('/\\evil.example/path'))).toBe('/dashboard');
  });

  it('rejects destinations that normalize to the sentinel origin', () => {
    expect(destinationFrom(returnToSearch('/\\tabstop.invalid/path'))).toBe('/dashboard');
  });

  it('rejects absolute destinations', () => {
    expect(destinationFrom(returnToSearch('https://evil.example'))).toBe('/dashboard');
  });

  it('defaults when there is no query string at all', () => {
    expect(destinationFrom('')).toBe('/dashboard');
  });

  it('defaults when the parameter is absent', () => {
    expect(destinationFrom('?days=30')).toBe('/dashboard');
  });

  // The parameter arrives from the address bar, so anyone can write it by hand.
  it('rejects a destination someone typed rather than one we recorded', () => {
    expect(destinationFrom(`?${RETURN_TO_KEY}=https://evil.example`)).toBe('/dashboard');
  });
});

describe('returnToSearch', () => {
  it('encodes the destination so its own query survives the round trip', () => {
    // Written unencoded, `?days=30` would parse as a second parameter of the
    // login URL and the returning visitor would lose their filters.
    expect(returnToSearch('/pages/42?days=30#history')).toBe('?from=%2Fpages%2F42%3Fdays%3D30%23history');
  });
});
