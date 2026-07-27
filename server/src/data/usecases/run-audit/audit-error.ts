export type AuditFailure = {
  permanent: boolean
  message: string
}

const TRANSIENT: AuditFailure = {
  permanent: false,
  message: 'Something went wrong running this audit'
}

/**
 * Ordered most specific first. Matching is on the message text because
 * Playwright surfaces navigation failures as a generic error carrying a
 * net::ERR_* code in its message rather than a typed class.
 */
const PERMANENT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/net::ERR_NAME_NOT_RESOLVED/, 'Could not resolve that domain'],
  [/net::ERR_CONNECTION_REFUSED/, 'Nothing responded at that address'],
  [/net::ERR_UNSAFE_PORT/, "That port can't be audited"],
  [/net::ERR_CERT_/, "That site's security certificate could not be verified"],
  [
    /addScriptTag|Content Security Policy|axe is not defined/,
    'Could not run the accessibility engine on this page'
  ]
]

export const classifyAuditError = (error: unknown): AuditFailure => {
  if (!(error instanceof Error)) return TRANSIENT

  // Matched on `name`, NOT the constructor: Playwright's bundling means the
  // timeout's constructor.name is "TimeoutError2" while error.name is
  // "TimeoutError", so a constructor check would silently never match.
  if (error.name === 'TimeoutError') {
    // Deliberately duration-neutral: the navigation budget is configurable, so
    // naming a number here would be a lie under any non-default setting, and
    // the classifier has no business knowing the configuration.
    return { permanent: true, message: 'The page took too long to load' }
  }

  for (const [pattern, message] of PERMANENT_PATTERNS) {
    if (pattern.test(error.message)) return { permanent: true, message }
  }

  // Unrecognised failures are transient on purpose: a new failure mode is more
  // likely to be infrastructure than a permanent property of someone's page,
  // and the cost of being wrong is three attempts rather than a
  // wrongly-permanent failure the user cannot retry.
  return TRANSIENT
}
