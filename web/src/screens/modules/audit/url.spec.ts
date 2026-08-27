import {describe, expect, it} from 'vitest';
import {URL_PROBLEMS, hostOf, normaliseUrl} from './url';

const urlOf = (raw: string): string => {
  const result = normaliseUrl(raw);
  if (!result.ok) {
    throw new Error(`expected ${raw} to normalise, got ${result.problem}`);
  }
  return result.url;
};

describe('normaliseUrl', () => {
  describe('being forgiving about what someone types', () => {
    it('adds https to a bare domain', () => {
      expect(urlOf('example.com')).toBe('https://example.com/');
    });

    it('ignores surrounding whitespace, which a paste brings with it', () => {
      expect(urlOf('  example.com \n')).toBe('https://example.com/');
    });

    it('keeps a path, query and fragment', () => {
      expect(urlOf('example.com/pricing?plan=team#faq')).toBe('https://example.com/pricing?plan=team#faq');
    });

    it('lowercases the host but not the path, as a URL should', () => {
      expect(urlOf('Example.COM/Pricing')).toBe('https://example.com/Pricing');
    });

    it('leaves an explicit http alone rather than upgrading it', () => {
      expect(urlOf('http://example.com')).toBe('http://example.com/');
    });

    it('keeps a port on a dotted host', () => {
      expect(urlOf('example.com:8080/health')).toBe('https://example.com:8080/health');
    });

    it('keeps a port on localhost, the one dotless host anyone types with one', () => {
      expect(urlOf('localhost:3000')).toBe('https://localhost:3000/');
    });

    it('keeps a port on a bare IPv4 address', () => {
      expect(urlOf('192.168.0.1:8080')).toBe('https://192.168.0.1:8080/');
    });

    it('returns the canonical form, which is also what gets displayed', () => {
      expect(urlOf('example.com')).toBe('https://example.com/');
    });
  });

  describe('the two things it refuses', () => {
    it.each(['', '   ', '\t\n'])('refuses %p as empty', (raw) => {
      expect(normaliseUrl(raw)).toEqual({ok: false, problem: 'empty'});
    });

    it.each([
      // oxlint-disable-next-line no-script-url -- the refused input under test
      ['javascript:alert(1)', 'a scheme that names no page'],
      ['mailto:someone@example.com', 'an address rather than a page'],
      ['mailto:123', 'an opaque scheme whose payload is numeric'],
      // oxlint-disable-next-line no-script-url -- the refused input under test
      ['javascript:1', 'the same trap with an executable scheme'],
      ['https://', 'a scheme and nothing else'],
    ])('refuses %p - %s', (raw) => {
      expect(normaliseUrl(raw)).toEqual({ok: false, problem: 'unparseable'});
    });

    it('has a message for each problem it reports', () => {
      expect(Object.keys(URL_PROBLEMS).toSorted()).toEqual(['empty', 'unparseable']);
      for (const message of Object.values(URL_PROBLEMS)) {
        expect(message).not.toBe('');
      }
    });
  });

  describe('what it deliberately does NOT judge', () => {
    it('passes a non-http scheme through for the server to refuse', () => {
      expect(urlOf('ftp://example.com')).toBe('ftp://example.com/');
    });

    it('passes a private address through rather than deciding policy', () => {
      expect(urlOf('192.168.0.1')).toBe('https://192.168.0.1/');
    });

    it('passes embedded credentials through', () => {
      expect(urlOf('https://user:pw@example.com')).toBe('https://user:pw@example.com/');
    });

    it('accepts a hostname with no dot, leaving DNS to say so', () => {
      expect(urlOf('exampl')).toBe('https://exampl/');
    });
  });
});

describe('hostOf', () => {
  it('names a report after the site it audited', () => {
    expect(hostOf('https://example.com/checkout?step=2')).toBe('example.com');
  });

  it('keeps a port, which is how a staging host is told apart', () => {
    expect(hostOf('http://localhost:3000/')).toBe('localhost:3000');
  });

  it('drops the credentials some URLs carry, which are not part of a name', () => {
    expect(hostOf('https://user:secret@example.com/')).toBe('example.com');
  });

  it('hands back whatever it was given rather than throwing', () => {
    expect(hostOf('not a url')).toBe('not a url');
  });
});
