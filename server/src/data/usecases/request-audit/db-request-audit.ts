import { isIP } from 'node:net'
import {
  DEFAULT_URL_POLICY, bareHostname, parseAuditUrl, type UrlPolicy
} from '../../../domain/services/url-safety.js'
import type { DnsResolver } from '../../protocols/net/dns-resolver.js'
import type {
  RequestAudit, RequestAuditParams, RequestAuditResult
} from '../../../domain/usecases/request-audit.js'
import type { AddAuditRepository } from '../../protocols/db/audit/add-audit-repository.js'
import type {
  DeleteQueuedAuditRepository
} from '../../protocols/db/audit/delete-queued-audit-repository.js'
import type { JobQueue } from '../../protocols/queue/job-queue.js'

export type AuditJob = { auditId: string }

const ENQUEUE_ATTEMPTS = 3
const ENQUEUE_BACKOFF_MS = 50

export class DbRequestAudit implements RequestAudit {
  constructor (
    private readonly addAuditRepository: AddAuditRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: JobQueue<AuditJob>,
    private readonly dnsResolver: DnsResolver,
    private readonly urlPolicy: UrlPolicy = DEFAULT_URL_POLICY
  ) {}

  async request ({ url }: RequestAuditParams): Promise<RequestAuditResult> {
    // Gate 1, the half of #7 left open by the worker-side guard.
    const parsed = parseAuditUrl(url, this.urlPolicy)
    if (!parsed.safe) return { outcome: 'rejected', reason: parsed.reason }

    // Resolved as well as parsed. A hostname that answers with a private
    // address is rejected here rather than becoming a queued job, a browser
    // launch and a failed audit thirty seconds later.
    //
    // This costs a lookup per accepted request, which is only affordable
    // because the endpoint is off unless AUDIT_API_ENABLED is set - and #8,
    // which is what makes enabling it safe, also bounds how often this runs.
    // Gate 2 still re-resolves at fetch time: this answer cannot be trusted
    // by then, it merely rejects what is already known to be wrong.
    if (!await this.resolvesSafely(parsed.url)) {
      return { outcome: 'rejected', reason: 'blocked-address' }
    }

    // Insert BEFORE enqueue. Reversed, the worker can dequeue an id whose row
    // does not exist yet.
    const audit = await this.addAuditRepository.add({
      url: parsed.url.toString(),
      pageId: null
    })

    try {
      await this.enqueueWithRetry(audit.id)
    } catch {
      // The row was acknowledged to nobody, so removing it leaves nothing
      // stranded and the client simply retries for a fresh id. If the delete
      // fails too this degrades to a queued row nothing runs - strictly better
      // than not attempting it, and the only residual.
      await this.deleteQueuedAuditRepository.deleteIfQueued(audit.id).catch(() => undefined)
      return { outcome: 'unavailable' }
    }

    return { outcome: 'queued', audit }
  }

  private async resolvesSafely (url: URL): Promise<boolean> {
    const host = bareHostname(url)
    // A literal address was already checked by parseAuditUrl.
    if (isIP(host) !== 0) return true

    const addresses = await this.dnsResolver.resolve(host)
    // Empty means resolution failed: fail closed. And every address must be
    // safe - a host answering with one public and one private is a rebinding
    // attempt, not a coincidence.
    return addresses.length > 0 && addresses.every(
      (address) => !this.urlPolicy.isBlockedAddress(address)
    )
  }

  /** Most enqueue failures are a blip; absorbing them keeps the delete path for real outages. */
  private async enqueueWithRetry (auditId: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.auditQueue.enqueue({ auditId })
      } catch (error) {
        if (attempt >= ENQUEUE_ATTEMPTS) throw error
        await new Promise<void>((resolve) => {
          setTimeout(resolve, ENQUEUE_BACKOFF_MS * attempt).unref()
        })
      }
    }
  }
}
