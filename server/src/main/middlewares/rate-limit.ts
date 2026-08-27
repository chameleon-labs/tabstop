import {createHash} from 'node:crypto';
import ipaddr from 'ipaddr.js';
import type {NextFunction, Request, Response} from 'express';
import {toRateLimitedBody} from '../../presentation/helpers/rate-limit-view.js';
import type {BucketConfig, RateLimitAllowance, RateLimiter} from '../../data/protocols/rate-limit/rate-limiter.js';

export type RateLimitRule = {
  name: string;
  bucket: BucketConfig;
  key: (req: Request) => string | undefined;
};

export const makeRateLimit =
  (limiter: RateLimiter, rules: RateLimitRule[]) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const consumed: RateLimitAllowance[] = [];

    for (const rule of rules) {
      const rawKey = rule.key(req);
      if (rawKey === undefined) {
        continue;
      }
      const key = `${rule.name}:${rawKey}`;

      let decision;
      try {
        decision = await limiter.consume(key, rule.bucket);
      } catch (error) {
        console.warn('Rate limiter threw on consume; failing open:', error);
        continue;
      }
      if (decision.allowed) {
        consumed.push(decision);
        continue;
      }

      await Promise.all(
        consumed.map(async (taken) => {
          try {
            await taken.refund();
          } catch (error) {
            console.warn('Rate limiter refund failed; preserving denial:', error);
          }
        }),
      );

      const retryAfter = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
      res.set('retry-after', String(retryAfter));
      res.status(429).json(toRateLimitedBody(retryAfter, new Date()));
      return;
    }

    next();
  };

const hashEmail = (normalised: string): string => createHash('sha256').update(normalised).digest('hex').slice(0, 32);

export const emailKey = (req: Request): string | undefined => {
  const email = (req.body as {email?: unknown} | undefined)?.email;
  if (typeof email !== 'string') {
    return undefined;
  }

  const normalised = email.trim().toLowerCase();
  return normalised === '' ? undefined : `email:${hashEmail(normalised)}`;
};

const IPV6_BUCKET_PREFIX_GROUPS = 4;

const normaliseIp = (ip: string): string => {
  let parsed;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    return ip;
  }

  if (parsed instanceof ipaddr.IPv4) {
    return parsed.toNormalizedString();
  }
  if (parsed.isIPv4MappedAddress()) {
    return parsed.toIPv4Address().toNormalizedString();
  }

  const prefix = new ipaddr.IPv6([...parsed.parts.slice(0, IPV6_BUCKET_PREFIX_GROUPS), 0, 0, 0, 0]);
  return prefix.toNormalizedString();
};

export const ipKey = (req: Request): string => `ip:${req.ip === undefined ? 'unknown' : normaliseIp(req.ip)}`;
