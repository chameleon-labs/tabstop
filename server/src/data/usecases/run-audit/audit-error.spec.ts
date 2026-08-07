import {describe, expect, it} from 'vitest';
import {classifyAuditError} from './audit-error.js';

const named = (name: string, message: string): Error => Object.assign(new Error(message), {name});

describe('classifyAuditError', () => {
  const cases: Array<[string, unknown, boolean, string]> = [
    [
      'a navigation timeout',
      named('TimeoutError', 'page.goto: Timeout 20000ms exceeded.'),
      true,
      'The page took too long to load',
    ],
    [
      'an address the safety guard refused',
      new Error('page.goto: net::ERR_BLOCKED_BY_CLIENT at http://169.254.169.254/'),
      true,
      "That address can't be audited",
    ],
    [
      'a domain that does not resolve',
      new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at http://nope.invalid/'),
      true,
      'Could not resolve that domain',
    ],
    [
      'a refused connection',
      new Error('page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:45999/'),
      true,
      'Nothing responded at that address',
    ],
    [
      'a port Chromium refuses to open',
      new Error('page.goto: net::ERR_UNSAFE_PORT at http://127.0.0.1:9/'),
      true,
      "That port can't be audited",
    ],
    [
      'an untrusted certificate',
      new Error('page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://x/'),
      true,
      "That site's security certificate could not be verified",
    ],
    [
      'the engine throwing while it runs',
      new Error("page.evaluate: TypeError: Cannot read properties of null (reading 'nodeType')"),
      true,
      'Could not run the accessibility engine on this page',
    ],
    [
      'a Content Security Policy blocking the engine',
      new Error('page.addScriptTag: Executing inline script violates the following Content Security Policy'),
      true,
      'Could not run the accessibility engine on this page',
    ],
    [
      'a browser that closed mid-evaluate',
      new Error('page.evaluate: Target page, context or browser has been closed'),
      false,
      'Something went wrong running this audit',
    ],
    [
      'a launch timeout on an unhealthy host',
      named('TimeoutError', 'browserType.launch: Timeout 30000ms exceeded.'),
      false,
      'Something went wrong running this audit',
    ],
    [
      'a closed or crashed browser',
      new Error('browserType.launch: Target page, context or browser has been closed'),
      false,
      'Something went wrong running this audit',
    ],
    [
      'anything unrecognised',
      new Error('something nobody predicted'),
      false,
      'Something went wrong running this audit',
    ],
  ];

  it.each(cases)('classifies %s', (_label, error, permanent, message) => {
    expect(classifyAuditError(error)).toEqual({permanent, message});
  });

  it('identifies a timeout by name rather than by constructor', () => {
    // Playwright's bundling renames the class to TimeoutError2 while keeping
    // error.name as TimeoutError. An `instanceof` or constructor check here
    // would silently never match, and every timeout would be retried three
    // times before failing.
    class TimeoutError2 extends Error {}
    const error = Object.assign(new TimeoutError2('page.goto: Timeout 20000ms exceeded.'), {name: 'TimeoutError'});

    expect(error.constructor.name).toBe('TimeoutError2');
    expect(classifyAuditError(error).permanent).toBe(true);
  });

  it('does not let a crash disguised as an engine failure become permanent', () => {
    // "page.evaluate: ..." is how a mid-run browser crash surfaces, and the
    // engine-failure pattern matches that prefix. Classifying it permanent
    // would make a deliberately retryable failure unretryable.
    expect(
      classifyAuditError(new Error('page.evaluate: Target page, context or browser has been closed')).permanent,
    ).toBe(false);
  });

  it('keeps a launch timeout retryable, unlike a navigation timeout', () => {
    // Both carry error.name === 'TimeoutError'. Only one is the page's fault.
    const launch = named('TimeoutError', 'browserType.launch: Timeout 30000ms exceeded.');
    const navigation = named('TimeoutError', 'page.goto: Timeout 20000ms exceeded.');

    expect(classifyAuditError(launch).permanent).toBe(false);
    expect(classifyAuditError(navigation).permanent).toBe(true);
  });

  it('treats a thrown non-Error as transient rather than throwing itself', () => {
    for (const thrown of ['a string', undefined, null, 42, {message: 'not an Error'}]) {
      expect(classifyAuditError(thrown)).toEqual({
        permanent: false,
        message: 'Something went wrong running this audit',
      });
    }
  });
});
