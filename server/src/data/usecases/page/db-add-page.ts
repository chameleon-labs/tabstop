import {bareHostname, canonicalPageUrl, parseAuditUrl, type UrlPolicy} from '../../../domain/services/url-safety.js';
import type {AddPage, AddPageParams, AddPageResult} from '../../../domain/usecases/add-page.js';
import {enqueueAudit, resolvesSafely} from '../../helpers/audit-submission.js';
import type {AddPageRepository} from '../../protocols/db/page/add-page-repository.js';
import type {DeleteQueuedAuditRepository} from '../../protocols/db/audit/delete-queued-audit-repository.js';
import type {DnsResolver} from '../../protocols/net/dns-resolver.js';
import type {AuditJobQueue} from '../../protocols/queue/audit-job-queue.js';

export class DbAddPage implements AddPage {
  constructor(
    private readonly addPageRepository: AddPageRepository,
    private readonly deleteQueuedAuditRepository: DeleteQueuedAuditRepository,
    private readonly auditQueue: AuditJobQueue,
    private readonly dnsResolver: DnsResolver,
    // Injected rather than defaulted, per the boundary main established: data/
    // must not name the concrete policy, because that meant a node:net import
    // in a layer that has to stay free of the runtime.
    private readonly urlPolicy: UrlPolicy,
    private readonly limit: number,
  ) {}

  async add({userId, url}: AddPageParams): Promise<AddPageResult> {
    const parsed = parseAuditUrl(url, this.urlPolicy);
    if (!parsed.safe) {
      return {outcome: 'rejected', reason: parsed.reason};
    }

    // Worth a lookup here in a way it is not for a one-off audit: a monitored
    // page is fetched again every night, so a host that already resolves into
    // private space would otherwise become a failed audit and, once #14 lands,
    // an alert - every day, forever, until somebody deletes the page.
    if (!(await resolvesSafely(parsed.url, this.dnsResolver, this.urlPolicy))) {
      return {outcome: 'rejected', reason: 'blocked-address'};
    }

    const result = await this.addPageRepository.add({
      userId,
      // The host, not the registrable domain. Deriving the latter needs the
      // Public Suffix List, and every consumer that exists - the daily
      // scheduler (#13), the politeness lock (#41), the per-account cap - keys
      // on the host or on the account, so it would be a dependency with a
      // staleness problem bought for nothing. See the plan for #11.
      domain: bareHostname(parsed.url),
      url: canonicalPageUrl(parsed.url),
      limit: this.limit,
    });

    if (result.outcome === 'limit-reached') {
      return {outcome: 'limit-reached', limit: this.limit};
    }
    if (result.outcome === 'duplicate') {
      return {outcome: 'duplicate'};
    }

    // AFTER the commit, never inside the transaction. A job enqueued inside a
    // transaction that then rolls back leaves the queue holding work for a page
    // that does not exist.
    const enqueued = await enqueueAudit(this.auditQueue, result.firstAudit.id);

    if (enqueued === 'failed') {
      // The page stays. Refusing to track it because Redis blinked would be
      // the wrong trade - but the audit row must go, or the dashboard renders
      // a run that nothing will ever pick up as permanently in progress.
      //
      // `unknown` deliberately does not land here: the queue may have accepted
      // the job and lost the reply, and deleting the row then would leave a
      // job pointing at an audit that no longer exists.
      await this.deleteQueuedAuditRepository.deleteIfQueued(result.firstAudit.id).catch(() => undefined);
      return {outcome: 'added', page: result.page, firstAuditId: null};
    }

    return {
      outcome: 'added',
      page: result.page,
      // The public uuid, never the internal id - the client watches this the
      // same way it watches an anonymous submission.
      firstAuditId: result.firstAudit.publicUuid,
    };
  }
}
