import {parseAuditUrl, type UrlPolicy} from '../../../domain/services/url-safety.js';
import {ENQUEUE_TIMEOUT_MS, enqueueAudit, resolvesSafely, withTimeout} from '../../helpers/audit-submission.js';
import type {DnsResolver} from '../../protocols/net/dns-resolver.js';
import type {RequestAudit, RequestAuditParams, RequestAuditResult} from '../../../domain/usecases/request-audit.js';
import type {AddAuditRepository} from '../../protocols/db/audit/add-audit-repository.js';
import type {DeleteQueuedAuditRepository} from '../../protocols/db/audit/delete-queued-audit-repository.js';
import type {AuditJobQueue} from '../../protocols/queue/audit-job-queue.js';

/**
 * Roughly an hour of backlog at the default concurrency of one, so a client
 * that IS accepted still gets a result rather than a place in a line nobody
 * will reach. Overridable, because the right number depends on worker count.
 */
const DEFAULT_MAX_QUEUE_DEPTH = 100;

export class DbRequestAudit implements RequestAudit {
  constructor(
    private readonly addAuditRepository: AddAuditRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: AuditJobQueue,
    private readonly dnsResolver: DnsResolver,
    // Required, per the boundary main established: data/ must not name the
    // concrete policy, because doing so meant importing node:net into a layer
    // that has to stay free of the runtime. The composition root injects it.
    private readonly urlPolicy: UrlPolicy,
    private readonly maxQueueDepth: number = DEFAULT_MAX_QUEUE_DEPTH,
  ) {}

  async request({url}: RequestAuditParams): Promise<RequestAuditResult> {
    // Gate 1, the half of #7 left open by the worker-side guard.
    const parsed = parseAuditUrl(url, this.urlPolicy);
    if (!parsed.safe) return {outcome: 'rejected', reason: parsed.reason};

    // Resolved as well as parsed. A hostname that answers with a private
    // address is rejected here rather than becoming a queued job, a browser
    // launch and a failed audit thirty seconds later.
    //
    // This costs a lookup per accepted request, which is only affordable
    // because the per-IP rate limit in front of this endpoint bounds how
    // often it runs. Gate 2 still re-resolves at fetch time: this answer
    // cannot be trusted by then, it merely rejects what is already known to
    // be wrong.
    if (!(await resolvesSafely(parsed.url, this.dnsResolver, this.urlPolicy))) {
      return {outcome: 'rejected', reason: 'blocked-address'};
    }

    // The gap a per-IP bucket cannot close. That bucket bounds ONE source,
    // and the queue is shared by every source: enough distinct addresses,
    // each politely inside its own allowance, still drive the backlog to
    // whatever length they collectively want. Nothing downstream refuses it
    // either - AUDIT_CONCURRENCY bounds how many audits RUN at once, not how
    // many wait, and each waiting one is a Redis job plus a row somebody is
    // polling for a result that is hours away.
    //
    // Checked here, after the url has been accepted and before the insert:
    // a rejected url still gets its own specific message rather than a
    // generic "try again later", and a refusal strands no row.
    if (await this.queueIsSaturated()) return {outcome: 'unavailable'};

    // Insert BEFORE enqueue. Reversed, the worker can dequeue an id whose row
    // does not exist yet.
    const audit = await this.addAuditRepository.add({
      url: parsed.url.toString(),
      pageId: null,
    });

    // `unknown` counts as queued: failing to confirm an enqueue is not the
    // same as it not happening - Redis may have committed the job and lost
    // the reply - and deleting the row then would leave a job pointing at an
    // audit that no longer exists.
    const enqueued = await enqueueAudit(this.auditQueue, audit.id);

    if (enqueued === 'failed') {
      // Genuinely not queued. The row was acknowledged to nobody, so removing
      // it strands nothing and the client retries for a fresh id. If the
      // delete fails too this degrades to a queued row nothing runs, which is
      // the only residual.
      await this.deleteQueuedAuditRepository.deleteIfQueued(audit.id).catch(() => undefined);
      return {outcome: 'unavailable'};
    }

    return {outcome: 'queued', audit};
  }

  /**
   * Bounded, best-effort, and a SOFT edge - it fails open, and it does not
   * make the cap exact.
   *
   * Reading the depth and then enqueueing is check-then-act: everything
   * already in flight has passed the check, so a burst of simultaneous
   * submissions - across instances too - all get in, and the queue lands over
   * the cap by roughly the size of the burst. What is bounded is the steady
   * state: every request arriving afterwards sees the raised depth and is
   * refused, so the queue spikes and drains rather than growing without
   * limit. That is the property this exists for.
   *
   * Making the edge hard needs an atomic reservation in Redis, released on
   * both the insert and the enqueue failing, with a TTL for the process dying
   * in between. That is a distributed semaphore - and to respect this
   * branch's rule that Redis is not a hard dependency of the write path it
   * would have to fail open, at which point it is not atomic when it matters
   * either. Pinned by a spec so the limitation is understood rather than
   * assumed away.
   *
   * A depth check that cannot answer must not become a second way for a sick
   * Redis to refuse submissions. The enqueue below already handles a queue
   * that is genuinely unreachable, and it does so by retrying first - whereas
   * treating "I could not measure" as "it is full" would make an unmeasurable
   * queue indistinguishable from a saturated one, and turn a Redis blip into
   * a blanket 503 on the endpoint that is the product's hook.
   */
  private async queueIsSaturated(): Promise<boolean> {
    try {
      const backlog = await withTimeout(this.auditQueue.backlogCount(), ENQUEUE_TIMEOUT_MS);
      return backlog >= this.maxQueueDepth;
    } catch {
      return false;
    }
  }
}
