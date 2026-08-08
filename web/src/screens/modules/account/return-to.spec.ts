import {describe, expect, it} from 'vitest';
import {RETURN_TO_KEY} from './components/RequireAuth';
import {destinationFrom} from './return-to';

describe('destinationFrom', () => {
  it('keeps an app-local destination including search and hash', () => {
    expect(destinationFrom({[RETURN_TO_KEY]: '/pages/42?days=30#history'})).toBe('/pages/42?days=30#history');
  });

  it('rejects protocol-relative destinations', () => {
    expect(destinationFrom({[RETURN_TO_KEY]: '//evil.example/path'})).toBe('/dashboard');
  });

  it('rejects absolute destinations', () => {
    expect(destinationFrom({[RETURN_TO_KEY]: 'https://evil.example'})).toBe('/dashboard');
  });

  it('defaults when router state is absent', () => {
    expect(destinationFrom(null)).toBe('/dashboard');
  });

  it('defaults when the return value is not a string', () => {
    expect(destinationFrom({[RETURN_TO_KEY]: 42})).toBe('/dashboard');
  });
});
