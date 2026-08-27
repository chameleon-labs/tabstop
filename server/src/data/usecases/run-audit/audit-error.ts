export type AuditFailure = {
  permanent: boolean;
  message: string;
};

const TRANSIENT: AuditFailure = {
  permanent: false,
  message: 'Something went wrong running this audit',
};

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /has been closed/,
  /Target closed/,
  /crashed/i,
  /Protocol error/,
  /browserType\.launch/,
];

const PERMANENT_PATTERNS: readonly (readonly [RegExp, string])[] = [
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

  if (error.name === 'TimeoutError' && error.message.includes('page.goto')) {
    return {permanent: true, message: 'The page took too long to load'};
  }

  for (const [pattern, message] of PERMANENT_PATTERNS) {
    if (pattern.test(error.message)) {
      return {permanent: true, message};
    }
  }

  return TRANSIENT;
};
