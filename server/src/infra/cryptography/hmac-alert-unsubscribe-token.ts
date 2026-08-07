import {createHmac, timingSafeEqual} from 'node:crypto';
import type {AlertUnsubscribeTokenCodec} from '../../data/protocols/cryptography/alert-unsubscribe-token-codec.js';

const MAX_BIGINT = 9_223_372_036_854_775_807n;
const PAGE_ID = /^[1-9]\d{0,18}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;

export class HmacAlertUnsubscribeToken implements AlertUnsubscribeTokenCodec {
  constructor(private readonly secret: string) {}

  encode(pageId: string): string {
    if (!this.isPageId(pageId)) throw new Error('Cannot sign an invalid page id');
    return `v1.${pageId}.${this.signatureFor(pageId)}`;
  }

  decode(token: string): string | null {
    const match = /^v1\.([^.]+)\.([^.]+)$/.exec(token);
    if (match === null) return null;

    const [, pageId, signature] = match;
    if (pageId === undefined || signature === undefined || !this.isPageId(pageId) || !SIGNATURE.test(signature)) {
      return null;
    }

    const expected = Buffer.from(this.signatureFor(pageId));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received) ? pageId : null;
  }

  private signatureFor(pageId: string): string {
    return createHmac('sha256', this.secret).update(`tabstop:page-alerts:v1:${pageId}`).digest('base64url');
  }

  private isPageId(value: string): boolean {
    return PAGE_ID.test(value) && BigInt(value) <= MAX_BIGINT;
  }
}
