import {isValidScryptCost} from '../../infra/cryptography/scrypt-adapter.js';

export type Env = {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  frontendOrigin: string;
  publicApiOrigin: string;
  mailDriver: 'console' | 'resend';
  resendApiKey: string | null;
  mailFrom: string;
  alertUnsubscribeSecret: string;
  sessionCookieSecure: boolean;
  scryptCost: number;
  sessionTtlDays: number;
  auditConcurrency: number;
  auditJobTimeoutMs: number;
  auditNavigationTimeoutMs: number;
  auditSettleBudgetMs: number;
  auditFallbackSettleMs: number;
  trustProxyHops: number;
  auditRateCapacity: number;
  auditRatePerHour: number;
  auditQueueMaxDepth: number;
  databaseStatementTimeoutMs: number;
};

const DEFAULT_PORT = 3000;
const DEFAULT_SCRYPT_COST = 32768;
const DEFAULT_SESSION_TTL_DAYS = 30;

const MAX_SESSION_TTL_DAYS = 400;

const DEFAULT_TRUST_PROXY_HOPS = 0;
const MAX_TRUST_PROXY_HOPS = 8;
const DEFAULT_AUDIT_RATE_CAPACITY = 5;
const DEFAULT_AUDIT_RATE_PER_HOUR = 5;
const DEFAULT_AUDIT_QUEUE_MAX_DEPTH = 100;
const MAX_AUDIT_QUEUE_MAX_DEPTH = 10_000;
const MAX_AUDIT_RATE_CAPACITY = 1000;
const MAX_AUDIT_RATE_PER_HOUR = 1000;

const DEFAULT_AUDIT_CONCURRENCY = 1;
const MAX_AUDIT_CONCURRENCY = 16;
const DEFAULT_AUDIT_JOB_TIMEOUT_MS = 45_000;
const DEFAULT_AUDIT_NAVIGATION_TIMEOUT_MS = 20_000;
const DEFAULT_AUDIT_SETTLE_BUDGET_MS = 10_000;
const DEFAULT_AUDIT_FALLBACK_SETTLE_MS = 1_000;
const MAX_AUDIT_TIMEOUT_MS = 600_000;

const AUDIT_EXECUTION_HEADROOM_MS = 10_000;

const DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS = 30_000;
const MAX_DATABASE_STATEMENT_TIMEOUT_MS = 300_000;

const required = (source: NodeJS.ProcessEnv, name: string): string => {
  const value = source[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is required but was not set`);
  }
  return value;
};

const requiredBoolean = (source: NodeJS.ProcessEnv, name: string): boolean => {
  const value = required(source, name);
  if (value !== 'true' && value !== 'false') {
    throw new Error(`${name} must be "true" or "false", but was "${value}"`);
  }
  return value === 'true';
};

const requiredOrigin = (source: NodeJS.ProcessEnv, name: string): string => {
  const value = required(source, name);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) origin, but was "${value}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${name} must use http or https, but was "${value}"`);
  }
  if (parsed.origin !== value) {
    throw new Error(
      `${name} must be exactly an origin, with no path or trailing slash - ` +
        `expected "${parsed.origin}" but was "${value}"`,
    );
  }

  return parsed.origin;
};

const mailDriver = (source: NodeJS.ProcessEnv): 'console' | 'resend' => {
  const value = source.MAIL_DRIVER;
  if (value === undefined || value === '') {
    return 'console';
  }
  if (value !== 'console' && value !== 'resend') {
    throw new Error(`MAIL_DRIVER must be "console" or "resend", but was "${value}"`);
  }
  return value;
};

const alertUnsubscribeSecret = (source: NodeJS.ProcessEnv): string => {
  const secret = required(source, 'ALERT_UNSUBSCRIBE_SECRET');
  if (Buffer.byteLength(secret) < 32) {
    throw new Error('ALERT_UNSUBSCRIBE_SECRET must contain at least 32 bytes');
  }
  return secret;
};

const positiveIntegerOr = (
  raw: string | undefined,
  fallback: number,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, but was "${raw}"`);
  }
  if (parsed > maximum) {
    throw new Error(`${name} must be at most ${maximum}, but was "${raw}"`);
  }
  return parsed;
};

const nonNegativeIntegerOr = (
  raw: string | undefined,
  fallback: number,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number => {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, but was "${raw}"`);
  }
  if (parsed > maximum) {
    throw new Error(`${name} must be at most ${maximum}, but was "${raw}"`);
  }
  return parsed;
};

const scryptCostOr = (raw: string | undefined, fallback: number): number => {
  const cost = positiveIntegerOr(raw, fallback, 'SCRYPT_COST');
  if (!isValidScryptCost(cost)) {
    throw new Error(`SCRYPT_COST must be a power of two that fits scrypt's memory budget, but was "${cost}"`);
  }
  return cost;
};

export const parseEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const rawPort = source.PORT;
  const parsedPort = Number(rawPort);
  const hasValidPort = rawPort !== undefined && rawPort !== '' && Number.isFinite(parsedPort);
  const databaseUrl = required(source, 'DATABASE_URL');
  const redisUrl = required(source, 'REDIS_URL');
  const frontendOrigin = requiredOrigin(source, 'FRONTEND_ORIGIN');
  const sessionCookieSecure = requiredBoolean(source, 'SESSION_COOKIE_SECURE');

  const auditJobTimeoutMs = positiveIntegerOr(
    source.AUDIT_JOB_TIMEOUT_MS,
    DEFAULT_AUDIT_JOB_TIMEOUT_MS,
    'AUDIT_JOB_TIMEOUT_MS',
    MAX_AUDIT_TIMEOUT_MS,
  );
  const auditNavigationTimeoutMs = positiveIntegerOr(
    source.AUDIT_NAVIGATION_TIMEOUT_MS,
    DEFAULT_AUDIT_NAVIGATION_TIMEOUT_MS,
    'AUDIT_NAVIGATION_TIMEOUT_MS',
    MAX_AUDIT_TIMEOUT_MS,
  );
  const auditSettleBudgetMs = positiveIntegerOr(
    source.AUDIT_SETTLE_BUDGET_MS,
    DEFAULT_AUDIT_SETTLE_BUDGET_MS,
    'AUDIT_SETTLE_BUDGET_MS',
    MAX_AUDIT_TIMEOUT_MS,
  );
  const auditFallbackSettleMs = positiveIntegerOr(
    source.AUDIT_FALLBACK_SETTLE_MS,
    DEFAULT_AUDIT_FALLBACK_SETTLE_MS,
    'AUDIT_FALLBACK_SETTLE_MS',
    MAX_AUDIT_TIMEOUT_MS,
  );

  const innerBudget =
    auditNavigationTimeoutMs + auditSettleBudgetMs + auditFallbackSettleMs + AUDIT_EXECUTION_HEADROOM_MS;
  if (innerBudget > auditJobTimeoutMs) {
    throw new Error(
      'AUDIT_JOB_TIMEOUT_MS must leave room for the navigation budgets: ' +
        `navigation + settle + fallback + ${AUDIT_EXECUTION_HEADROOM_MS}ms of execution ` +
        `headroom is ${innerBudget}ms, which exceeds AUDIT_JOB_TIMEOUT_MS of ${auditJobTimeoutMs}ms`,
    );
  }

  const selectedMailDriver = mailDriver(source);
  const resendApiKey = selectedMailDriver === 'resend' ? required(source, 'RESEND_API_KEY') : null;
  const publicApiOrigin = requiredOrigin(source, 'PUBLIC_API_ORIGIN');
  if (selectedMailDriver === 'resend' && !publicApiOrigin.startsWith('https://')) {
    throw new Error('PUBLIC_API_ORIGIN must use https when MAIL_DRIVER=resend');
  }

  return {
    port: hasValidPort ? parsedPort : DEFAULT_PORT,
    databaseUrl,
    redisUrl,
    frontendOrigin,
    publicApiOrigin,
    mailDriver: selectedMailDriver,
    resendApiKey,
    mailFrom: required(source, 'MAIL_FROM'),
    alertUnsubscribeSecret: alertUnsubscribeSecret(source),
    sessionCookieSecure,
    scryptCost: scryptCostOr(source.SCRYPT_COST, DEFAULT_SCRYPT_COST),
    sessionTtlDays: positiveIntegerOr(
      source.SESSION_TTL_DAYS,
      DEFAULT_SESSION_TTL_DAYS,
      'SESSION_TTL_DAYS',
      MAX_SESSION_TTL_DAYS,
    ),
    auditConcurrency: positiveIntegerOr(
      source.AUDIT_CONCURRENCY,
      DEFAULT_AUDIT_CONCURRENCY,
      'AUDIT_CONCURRENCY',
      MAX_AUDIT_CONCURRENCY,
    ),
    auditJobTimeoutMs,
    auditNavigationTimeoutMs,
    auditSettleBudgetMs,
    auditFallbackSettleMs,
    trustProxyHops: nonNegativeIntegerOr(
      source.TRUST_PROXY_HOPS,
      DEFAULT_TRUST_PROXY_HOPS,
      'TRUST_PROXY_HOPS',
      MAX_TRUST_PROXY_HOPS,
    ),
    auditRateCapacity: positiveIntegerOr(
      source.AUDIT_RATE_CAPACITY,
      DEFAULT_AUDIT_RATE_CAPACITY,
      'AUDIT_RATE_CAPACITY',
      MAX_AUDIT_RATE_CAPACITY,
    ),
    auditRatePerHour: positiveIntegerOr(
      source.AUDIT_RATE_PER_HOUR,
      DEFAULT_AUDIT_RATE_PER_HOUR,
      'AUDIT_RATE_PER_HOUR',
      MAX_AUDIT_RATE_PER_HOUR,
    ),
    auditQueueMaxDepth: positiveIntegerOr(
      source.AUDIT_QUEUE_MAX_DEPTH,
      DEFAULT_AUDIT_QUEUE_MAX_DEPTH,
      'AUDIT_QUEUE_MAX_DEPTH',
      MAX_AUDIT_QUEUE_MAX_DEPTH,
    ),
    databaseStatementTimeoutMs: positiveIntegerOr(
      source.DATABASE_STATEMENT_TIMEOUT_MS,
      DEFAULT_DATABASE_STATEMENT_TIMEOUT_MS,
      'DATABASE_STATEMENT_TIMEOUT_MS',
      MAX_DATABASE_STATEMENT_TIMEOUT_MS,
    ),
  };
};

export const env = parseEnv();
