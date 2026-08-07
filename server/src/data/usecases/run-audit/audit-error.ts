export type AuditFailure = {
  permanent: boolean;
  message: string;
};

const TRANSIENT: AuditFailure = {
  permanent: false,
  message: 'Something went wrong running this audit',
};

/**
 * Checked BEFORE anything else, because a crash or a teardown surfaces through
 * whichever Playwright call happened to be in flight. Matching on the method
 * prefix alone would turn "page.evaluate: Target page, context or browser has
 * been closed" - a browser crash, which is deliberately retryable - into a
 * permanent engine failure the user could never retry.
 */
const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /has been closed/,
  /Target closed/,
  /crashed/i,
  /Protocol error/,
  // A launch failure is a property of this host, never of the audited page.
  /browserType\.launch/,
];

/**
 * Ordered most specific first. Matching is on the message text because
 * Playwright surfaces navigation failures as a generic error carrying a
 * net::ERR_* code in its message rather than a typed class.
 */
const PERMANENT_PATTERNS: readonly (readonly [RegExp, string])[] = [
  // Deliberately vague, and deliberately identical whatever the reason. A
  // message distinguishing "blocked" from "unreachable" would turn the audit
  // endpoint into an internal port scanner. Permanent because a blocked
  // address is blocked identically on every retry - without this the
  // classifier treats it as unrecognised and burns three attempts on it.
  [/net::ERR_BLOCKED_BY_CLIENT/, "That address can't be audited"],
  [/net::ERR_NAME_NOT_RESOLVED/, 'Could not resolve that domain'],
  [/net::ERR_CONNECTION_REFUSED/, 'Nothing responded at that address'],
  [/net::ERR_UNSAFE_PORT/, "That port can't be audited"],
  [/net::ERR_CERT_/, "That site's security certificate could not be verified"],
  [
    /addScriptTag|page\.evaluate|Content Security Policy|axe is not defined/,
    'Could not run the accessibility engine on this page',
  ],
];

export const classifyAuditError = (error: unknown): AuditFailure => {
  if (!(error instanceof Error)) {
    return TRANSIENT;
  }

  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(error.message))) {
    return TRANSIENT;
  }

  // Scoped to page.goto deliberately. `chromium.launch()` times out with the
  // same error NAME, and a slow or unhealthy worker host is not a property of
  // the page - marking that permanent would fail an audit the user cannot
  // retry, for a problem that is ours.
  //
  // Matched on `name`, NOT the constructor: Playwright's bundling means the
  // timeout's constructor.name is "TimeoutError2" while error.name is
  // "TimeoutError", so a constructor check would silently never match.
  if (error.name === 'TimeoutError' && error.message.includes('page.goto')) {
    // Deliberately duration-neutral: the navigation budget is configurable, so
    // naming a number here would be a lie under any non-default setting, and
    // the classifier has no business knowing the configuration.
    return {permanent: true, message: 'The page took too long to load'};
  }

  for (const [pattern, message] of PERMANENT_PATTERNS) {
    if (pattern.test(error.message)) {
      return {permanent: true, message};
    }
  }

  // Unrecognised failures are transient on purpose: a new failure mode is more
  // likely to be infrastructure than a permanent property of someone's page,
  // and the cost of being wrong is three attempts rather than a
  // wrongly-permanent failure the user cannot retry.
  return TRANSIENT;
};
