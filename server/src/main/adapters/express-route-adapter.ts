import type {CookieOptions, Request, Response} from 'express';
import type {Controller} from '../../presentation/protocols/controller.js';
import type {CookieDirective} from '../../presentation/protocols/http.js';
import {env} from '../config/env.js';
import {parseCookies} from './cookies.js';

const SESSION_COOKIE_ATTRIBUTES: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.sessionCookieSecure,
  path: '/',
};

const CONTROLLER_HEADERS = new Set(['cache-control', 'vary']);

export const applyCookies = (res: Response, cookies: CookieDirective[] | undefined): void => {
  for (const cookie of cookies ?? []) {
    if (cookie.action === 'set') {
      res.cookie(cookie.name, cookie.value, {
        ...SESSION_COOKIE_ATTRIBUTES,
        expires: cookie.expiresAt,
      });
    } else {
      res.clearCookie(cookie.name, SESSION_COOKIE_ATTRIBUTES);
    }
  }
};

export const adaptRoute =
  <TRequest>(controller: Controller<TRequest>) =>
  async (req: Request, res: Response): Promise<void> => {
    const httpRequest = {
      ...req.body,
      ...req.query,
      ...req.params,
      cookies: parseCookies(req.headers.cookie),
      ...res.locals,
    } as TRequest;

    const httpResponse = await controller.handle(httpRequest);

    applyCookies(res, httpResponse.cookies);

    for (const [name, value] of Object.entries(httpResponse.headers ?? {})) {
      const header = name.toLowerCase();
      if (!CONTROLLER_HEADERS.has(header)) {
        continue;
      }

      if (header === 'vary') {
        res.append(header, value);
      } else {
        res.set(header, value);
      }
    }

    if (httpResponse.bodyType === 'html') {
      res.set({
        'content-security-policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
      });
      res.status(httpResponse.statusCode).type('html').send(httpResponse.body);
    } else {
      res.status(httpResponse.statusCode).json(httpResponse.body);
    }
  };
