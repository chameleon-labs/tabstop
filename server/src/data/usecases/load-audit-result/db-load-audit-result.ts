import type {AuditResult, LoadAuditResult} from '../../../domain/usecases/load-audit-result.js';
import type {LoadAuditByPublicUuidRepository} from '../../protocols/db/audit/load-audit-by-public-uuid-repository.js';
import type {LoadViolationsByAuditIdRepository} from '../../protocols/db/violation/load-violations-by-audit-id-repository.js';

export class DbLoadAuditResult implements LoadAuditResult {
  constructor(
    private readonly loadAuditByPublicUuidRepository: LoadAuditByPublicUuidRepository,
    private readonly loadViolationsByAuditIdRepository: LoadViolationsByAuditIdRepository,
  ) {}

  async load(publicUuid: string): Promise<AuditResult | null> {
    const audit = await this.loadAuditByPublicUuidRepository.loadByPublicUuid(publicUuid);
    // No audit, no violations to fetch. Querying anyway would be a wasted round
    // trip on what is the common case for a mistyped share link.
    if (audit === null) {
      return null;
    }

    // Only a finished audit has a result to report. While one is running its
    // violations are whatever the current attempt has written so far, and a
    // retry replaces them wholesale - so publishing them would show a partial
    // set as though it were the answer. A failed audit's leftovers are worse:
    // they describe a run that did not complete.
    if (audit.status !== 'done') {
      return {audit, violations: []};
    }

    const violations = await this.loadViolationsByAuditIdRepository.loadByAuditId(audit.id);
    return {audit, violations};
  }
}
