import {bareHostname, type UrlPolicy} from '../../domain/services/url-safety.js';
import type {DnsResolver} from '../protocols/net/dns-resolver.js';
import type {AuditJobQueue} from '../protocols/queue/audit-job-queue.js';

const ENQUEUE_ATTEMPTS = 3;
const ENQUEUE_BACKOFF_MS = 50;

export const ENQUEUE_TIMEOUT_MS = 2000;

export const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> =>
  await Promise.race([
    work,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error('Timed out talking to the queue'));
      }, ms).unref();
    }),
  ]);

export const resolvesSafely = async (url: URL, dnsResolver: DnsResolver, urlPolicy: UrlPolicy): Promise<boolean> => {
  const host = bareHostname(url);
  if (urlPolicy.isIpLiteral(host)) {
    return true;
  }

  const addresses = await dnsResolver.resolve(host);
  return addresses.length > 0 && addresses.every((address) => !urlPolicy.isBlockedAddress(address));
};

export type EnqueueOutcome = 'queued' | 'unknown' | 'failed';

export const enqueueAudit = async (queue: AuditJobQueue, auditId: string, delayMs = 0): Promise<EnqueueOutcome> => {
  const submit = async (): Promise<void> => {
    if (delayMs <= 0) {
      await queue.enqueueOnce({auditId});
      return;
    }
    await queue.enqueueOnce({auditId}, {delayMs});
  };

  for (let attempt = 1; ; attempt++) {
    try {
      await withTimeout(submit(), ENQUEUE_TIMEOUT_MS);
      return 'queued';
    } catch {
      if (attempt >= ENQUEUE_ATTEMPTS) {
        break;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ENQUEUE_BACKOFF_MS * attempt).unref();
      });
    }
  }

  return (await queueAlreadyHas(queue, auditId)) ? 'unknown' : 'failed';
};

const queueAlreadyHas = async (queue: AuditJobQueue, auditId: string): Promise<boolean> => {
  try {
    return await withTimeout(queue.has(auditId), ENQUEUE_TIMEOUT_MS);
  } catch {
    return false;
  }
};
