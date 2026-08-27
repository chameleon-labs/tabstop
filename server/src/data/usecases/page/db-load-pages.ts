import type {PageSummary, ScheduledPageSummary} from '../../../domain/models/page.js';
import {nextReauditAt} from '../../../domain/services/reaudit-schedule.js';
import type {LoadPages, LoadPagesResult} from '../../../domain/usecases/load-pages.js';
import type {LoadPageSummariesRepository} from '../../protocols/db/page/load-page-summaries-repository.js';

export class DbLoadPages implements LoadPages {
  constructor(
    private readonly loadPageSummariesRepository: LoadPageSummariesRepository,
    private readonly limit: number,
  ) {}

  private scheduled(summary: PageSummary, now: Date): ScheduledPageSummary {
    const {latestAudit} = summary;

    return {
      page: summary.page,
      domain: summary.domain,
      latestAudit,
      history: summary.history,
      nextAuditAt: nextReauditAt(
        {
          domain: summary.domain,
          pageId: summary.page.id,
          monitoringEnabled: summary.page.monitoringEnabled,
          latest:
            latestAudit === null
              ? null
              : {
                  status: latestAudit.status,
                  createdAt: latestAudit.createdAt,
                  scheduledFor: latestAudit.scheduledFor,
                },
        },
        now,
      ),
    };
  }

  async load(userId: string): Promise<LoadPagesResult> {
    const now = new Date();
    const summaries = await this.loadPageSummariesRepository.loadSummariesForUser(userId);

    return {
      pages: summaries.map((summary): ScheduledPageSummary => this.scheduled(summary, now)),
      limit: this.limit,
    };
  }
}
