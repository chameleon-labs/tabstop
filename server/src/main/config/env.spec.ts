import {describe, expect, it} from 'vitest';
import {parseEnv} from './env.js';

const validSource = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  FRONTEND_ORIGIN: 'http://localhost:5173',
  PUBLIC_API_ORIGIN: 'http://localhost:3000',
  SESSION_COOKIE_SECURE: 'false',
  MAIL_FROM: 'Tabstop <alerts@alerts.example.test>',
  ALERT_UNSUBSCRIBE_SECRET: 'a'.repeat(64),
};

describe('parseEnv', () => {
  it('returns the parsed port when PORT is a valid number', () => {
    const result = parseEnv({...validSource, PORT: '4000'});

    expect(result.port).toBe(4000);
  });

  it('preserves PORT=0 rather than falling back', () => {
    const result = parseEnv({...validSource, PORT: '0'});

    expect(result.port).toBe(0);
  });

  it('falls back to 3000 when PORT is absent or empty', () => {
    expect(parseEnv({...validSource}).port).toBe(3000);
    expect(parseEnv({...validSource, PORT: ''}).port).toBe(3000);
  });

  it('falls back to 3000 when PORT is not a number', () => {
    expect(parseEnv({...validSource, PORT: 'nonsense'}).port).toBe(3000);
  });

  it('returns DATABASE_URL when set', () => {
    const result = parseEnv(validSource);

    expect(result.databaseUrl).toBe('postgres://user:pass@localhost:5432/db');
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow('DATABASE_URL');
  });

  it('throws when DATABASE_URL is empty', () => {
    expect(() => parseEnv({DATABASE_URL: ''})).toThrow('DATABASE_URL');
  });

  it('returns REDIS_URL when set', () => {
    const result = parseEnv(validSource);

    expect(result.redisUrl).toBe('redis://localhost:6379');
  });

  it('throws when REDIS_URL is missing', () => {
    expect(() => parseEnv({DATABASE_URL: 'postgres://x'})).toThrow('REDIS_URL');
  });

  it('throws when FRONTEND_ORIGIN is missing', () => {
    const {FRONTEND_ORIGIN: _FRONTEND_ORIGIN, ...rest} = validSource;
    expect(() => parseEnv(rest)).toThrow('FRONTEND_ORIGIN');
  });

  it('rejects a FRONTEND_ORIGIN that is not exactly an origin', () => {
    // Each of these boots cleanly under a mere non-empty check and then fails
    // every authenticated browser request.
    for (const bad of [
      '*',
      'http://localhost:5173/',
      'http://localhost:5173/app',
      'localhost:5173',
      'ftp://localhost:5173',
      'not a url',
    ]) {
      expect(() => parseEnv({...validSource, FRONTEND_ORIGIN: bad})).toThrow('FRONTEND_ORIGIN');
    }
  });

  it('accepts a canonical origin, with or without a port', () => {
    expect(parseEnv({...validSource, FRONTEND_ORIGIN: 'https://app.tabstop.dev'}).frontendOrigin).toBe(
      'https://app.tabstop.dev',
    );
    expect(parseEnv({...validSource, FRONTEND_ORIGIN: 'http://localhost:5173'}).frontendOrigin).toBe(
      'http://localhost:5173',
    );
  });

  it('requires a canonical public API origin for unsubscribe links', () => {
    const {PUBLIC_API_ORIGIN: _PUBLIC_API_ORIGIN, ...missing} = validSource;
    expect(() => parseEnv(missing)).toThrow('PUBLIC_API_ORIGIN');
    expect(() => parseEnv({...validSource, PUBLIC_API_ORIGIN: 'https://api.tabstop.dev/path'})).toThrow(
      'PUBLIC_API_ORIGIN',
    );
    expect(parseEnv(validSource).publicApiOrigin).toBe('http://localhost:3000');
  });

  it('defaults to console mail and requires an explicit key for Resend', () => {
    expect(parseEnv(validSource)).toMatchObject({
      mailDriver: 'console',
      resendApiKey: null,
      mailFrom: 'Tabstop <alerts@alerts.example.test>',
    });
    expect(
      parseEnv({
        ...validSource,
        PUBLIC_API_ORIGIN: 'https://api.tabstop.dev',
        MAIL_DRIVER: 'resend',
        RESEND_API_KEY: 're_test',
      }),
    ).toMatchObject({mailDriver: 'resend', resendApiKey: 're_test'});
    expect(() => parseEnv({...validSource, MAIL_DRIVER: 'resend'})).toThrow('RESEND_API_KEY');
    expect(() => parseEnv({...validSource, MAIL_DRIVER: 'smtp'})).toThrow('MAIL_DRIVER');
  });

  it('refuses to publish an insecure one-click URL through Resend', () => {
    expect(() =>
      parseEnv({
        ...validSource,
        MAIL_DRIVER: 'resend',
        RESEND_API_KEY: 're_test',
      }),
    ).toThrow('PUBLIC_API_ORIGIN must use https when MAIL_DRIVER=resend');
  });

  it('requires a secret long enough to resist guessing unsubscribe tokens', () => {
    expect(parseEnv(validSource).alertUnsubscribeSecret).toHaveLength(64);
    expect(() => parseEnv({...validSource, ALERT_UNSUBSCRIBE_SECRET: 'short'})).toThrow('ALERT_UNSUBSCRIBE_SECRET');
  });

  it('throws when SESSION_COOKIE_SECURE is missing', () => {
    const {SESSION_COOKIE_SECURE: _SESSION_COOKIE_SECURE, ...rest} = validSource;
    expect(() => parseEnv(rest)).toThrow('SESSION_COOKIE_SECURE');
  });

  it('rejects a SESSION_COOKIE_SECURE that is neither true nor false', () => {
    expect(() => parseEnv({...validSource, SESSION_COOKIE_SECURE: 'yes'})).toThrow(
      'SESSION_COOKIE_SECURE must be "true" or "false"',
    );
  });

  it('parses SESSION_COOKIE_SECURE as a boolean', () => {
    expect(parseEnv({...validSource, SESSION_COOKIE_SECURE: 'true'}).sessionCookieSecure).toBe(true);
    expect(parseEnv({...validSource, SESSION_COOKIE_SECURE: 'false'}).sessionCookieSecure).toBe(false);
  });

  it('defaults the scrypt cost and session ttl when they are unset', () => {
    expect(parseEnv(validSource).scryptCost).toBe(32768);
    expect(parseEnv(validSource).sessionTtlDays).toBe(30);
    expect(parseEnv({...validSource, SCRYPT_COST: '16384'}).scryptCost).toBe(16384);
  });

  it('rejects a set-but-unusable value rather than silently defaulting', () => {
    // Setting the variable is a statement of intent. Falling back to the
    // default would turn a deliberate change into a no-op nobody notices.
    expect(() => parseEnv({...validSource, SCRYPT_COST: 'nonsense'})).toThrow('SCRYPT_COST');
    expect(() => parseEnv({...validSource, SCRYPT_COST: '0'})).toThrow('SCRYPT_COST');
    expect(() => parseEnv({...validSource, SESSION_TTL_DAYS: '-1'})).toThrow('SESSION_TTL_DAYS');
  });

  it('defaults the audit budgets, and caps concurrency', () => {
    const parsed = parseEnv(validSource);
    // Chromium is 300-500MB per context, so one at a time is the safe default.
    expect(parsed.auditConcurrency).toBe(1);
    expect(parsed.auditJobTimeoutMs).toBe(45_000);
    expect(parsed.auditNavigationTimeoutMs).toBe(20_000);
    expect(parsed.auditSettleBudgetMs).toBe(10_000);
    expect(parsed.auditFallbackSettleMs).toBe(1_000);

    expect(parseEnv({...validSource, AUDIT_CONCURRENCY: '4'}).auditConcurrency).toBe(4);
    expect(() => parseEnv({...validSource, AUDIT_CONCURRENCY: '64'})).toThrow('AUDIT_CONCURRENCY');
    expect(() => parseEnv({...validSource, AUDIT_JOB_TIMEOUT_MS: '0'})).toThrow('AUDIT_JOB_TIMEOUT_MS');
  });

  it('rejects navigation budgets that the job timeout can never reach', () => {
    // Each budget passes its own check, but they are nested: the job timeout
    // aborts first, so a 600s navigation budget under the 45s default is dead
    // configuration - along with the specific error message mapped to it.
    expect(() => parseEnv({...validSource, AUDIT_NAVIGATION_TIMEOUT_MS: '600000'})).toThrow(
      'AUDIT_JOB_TIMEOUT_MS must leave room',
    );

    expect(() => parseEnv({...validSource, AUDIT_SETTLE_BUDGET_MS: '40000'})).toThrow(
      'AUDIT_JOB_TIMEOUT_MS must leave room',
    );
  });

  it('accepts navigation budgets that fit inside the job timeout', () => {
    // The defaults must themselves satisfy the invariant, or the process could
    // not boot at all: 20s + 10s + 1s + 10s headroom = 41s under a 45s budget.
    expect(parseEnv(validSource).auditNavigationTimeoutMs).toBe(20_000);

    expect(
      parseEnv({
        ...validSource,
        AUDIT_JOB_TIMEOUT_MS: '600000',
        AUDIT_NAVIGATION_TIMEOUT_MS: '500000',
      }).auditNavigationTimeoutMs,
    ).toBe(500_000);
  });

  it('rejects a session ttl beyond what a cookie can express', () => {
    // Browsers cap cookie expiry at 400 days, so a longer session would be
    // clamped in the browser while the row kept the longer expiry. And at
    // ~99,979,338 days the arithmetic leaves Date's range entirely, producing
    // an Invalid Date that node-postgres serialises as "0NaN-NaN-NaN..." -
    // which Postgres rejects, failing every signup and login.
    expect(() => parseEnv({...validSource, SESSION_TTL_DAYS: '401'})).toThrow('SESSION_TTL_DAYS');
    expect(() => parseEnv({...validSource, SESSION_TTL_DAYS: '100000000'})).toThrow('SESSION_TTL_DAYS');
  });

  it('accepts a session ttl up to the browser cookie cap', () => {
    expect(parseEnv({...validSource, SESSION_TTL_DAYS: '400'}).sessionTtlDays).toBe(400);
  });

  it('rejects a scrypt cost that is a positive integer but not a usable one', () => {
    // 20000 is an integer above zero and still makes every hash throw
    // ERR_CRYPTO_INVALID_SCRYPT_PARAMS: N must be a power of two.
    expect(() => parseEnv({...validSource, SCRYPT_COST: '20000'})).toThrow('power of two');
    // 262144 is a power of two that exceeds scrypt's memory budget.
    expect(() => parseEnv({...validSource, SCRYPT_COST: '262144'})).toThrow('SCRYPT_COST');
  });

  it('throws when REDIS_URL is empty', () => {
    expect(() => parseEnv({DATABASE_URL: 'postgres://x', REDIS_URL: ''})).toThrow('REDIS_URL');
  });

  it('defaults trustProxyHops to zero', () => {
    // Not `true`: Express would then trust the whole X-Forwarded-For chain,
    // and any client could prepend a fabricated address to mint a fresh rate
    // limit bucket per request. Over-restrictive fails visibly; over-trusting
    // fails silently and makes the limiter decorative.
    expect(parseEnv(validSource).trustProxyHops).toBe(0);
  });

  it('reads trustProxyHops from the environment', () => {
    expect(parseEnv({...validSource, TRUST_PROXY_HOPS: '2'}).trustProxyHops).toBe(2);
  });

  it('rejects a negative trustProxyHops', () => {
    expect(() => parseEnv({...validSource, TRUST_PROXY_HOPS: '-1'})).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('rejects a trustProxyHops beyond the configured maximum', () => {
    expect(() => parseEnv({...validSource, TRUST_PROXY_HOPS: '9'})).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('accepts an explicit trustProxyHops of zero, not just the omitted default', () => {
    // Zero is both the default and the safe setting, so it has to work when a
    // deployment sets it on purpose - not merely when the variable is absent
    // and falls through to the default.
    expect(parseEnv({...validSource, TRUST_PROXY_HOPS: '0'}).trustProxyHops).toBe(0);
  });

  it('accepts trustProxyHops at the configured maximum', () => {
    expect(parseEnv({...validSource, TRUST_PROXY_HOPS: '8'}).trustProxyHops).toBe(8);
  });

  it('rejects a non-integer trustProxyHops', () => {
    expect(() => parseEnv({...validSource, TRUST_PROXY_HOPS: '1.5'})).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('defaults the anonymous audit bucket', () => {
    const parsed = parseEnv(validSource);

    expect(parsed.auditRateCapacity).toBe(5);
    expect(parsed.auditRatePerHour).toBe(5);
  });

  it('reads the anonymous audit bucket from the environment', () => {
    const parsed = parseEnv({...validSource, AUDIT_RATE_CAPACITY: '20', AUDIT_RATE_PER_HOUR: '40'});

    expect(parsed.auditRateCapacity).toBe(20);
    expect(parsed.auditRatePerHour).toBe(40);
  });

  it('rejects an anonymous audit bucket beyond its configured maximum', () => {
    // This is the one dial documented as production-tunable, so unlike every
    // other numeric variable here, a stray extra zero would boot cleanly and
    // silently remove the limit that makes this endpoint deployable at all.
    expect(() => parseEnv({...validSource, AUDIT_RATE_CAPACITY: '50000'})).toThrow('AUDIT_RATE_CAPACITY');
    expect(() => parseEnv({...validSource, AUDIT_RATE_PER_HOUR: '50000'})).toThrow('AUDIT_RATE_PER_HOUR');
  });

  it('defaults the queue depth cap, and reads an override', () => {
    // The default is load-bearing rather than a placeholder: it is the only
    // thing bounding the queue in a deployment that never sets the variable,
    // which is every deployment until someone has a reason to tune it.
    expect(parseEnv(validSource).auditQueueMaxDepth).toBe(100);
    expect(parseEnv({...validSource, AUDIT_QUEUE_MAX_DEPTH: '250'}).auditQueueMaxDepth).toBe(250);
  });

  it('rejects a queue depth cap that would remove the bound', () => {
    // Same reasoning as the audit bucket above, and the same failure mode: a
    // stray zero boots cleanly and silently turns the backstop off, which is
    // invisible until the queue is already long.
    expect(() => parseEnv({...validSource, AUDIT_QUEUE_MAX_DEPTH: '100000'})).toThrow('AUDIT_QUEUE_MAX_DEPTH');
    expect(() => parseEnv({...validSource, AUDIT_QUEUE_MAX_DEPTH: '0'})).toThrow('AUDIT_QUEUE_MAX_DEPTH');
    expect(() => parseEnv({...validSource, AUDIT_QUEUE_MAX_DEPTH: 'lots'})).toThrow('AUDIT_QUEUE_MAX_DEPTH');
  });

  it('defaults the statement timeout, and reads an override', () => {
    // Load-bearing for the same reason as the queue cap: no deployment sets
    // this until someone has a reason to, so the default is the bound that
    // actually ships (#52).
    expect(parseEnv(validSource).databaseStatementTimeoutMs).toBe(30_000);
    expect(parseEnv({...validSource, DATABASE_STATEMENT_TIMEOUT_MS: '60000'}).databaseStatementTimeoutMs).toBe(60_000);
  });

  it('rejects a statement timeout that would remove the bound', () => {
    // A stray extra zero boots cleanly and restores exactly the unbounded
    // behaviour this variable exists to remove, which is invisible until a
    // statement is already wedged holding a pooled connection.
    expect(() => parseEnv({...validSource, DATABASE_STATEMENT_TIMEOUT_MS: '3000000'})).toThrow(
      'DATABASE_STATEMENT_TIMEOUT_MS',
    );
    // Zero is Postgres's own spelling of "no timeout", so it has to be
    // refused here rather than passed through as a valid-looking setting.
    expect(() => parseEnv({...validSource, DATABASE_STATEMENT_TIMEOUT_MS: '0'})).toThrow(
      'DATABASE_STATEMENT_TIMEOUT_MS',
    );
    expect(() => parseEnv({...validSource, DATABASE_STATEMENT_TIMEOUT_MS: 'never'})).toThrow(
      'DATABASE_STATEMENT_TIMEOUT_MS',
    );
  });
});
