import type {AlertUnsubscribeTokenCodec} from '../../protocols/cryptography/alert-unsubscribe-token-codec.js';
import type {
  AlertDelivery,
  AlertViolation,
  LoadAlertDeliveryRepository,
} from '../../protocols/db/alert-event/load-alert-delivery-repository.js';
import type {MarkAlertEmailedRepository} from '../../protocols/db/alert-event/mark-alert-emailed-repository.js';
import type {MarkAlertFailedRepository} from '../../protocols/db/alert-event/mark-alert-failed-repository.js';
import type {ClaimAlertPreviewRepository} from '../../protocols/db/alert-event/claim-alert-preview-repository.js';
import type {AlertDispatchMode} from '../../protocols/db/alert-event/load-pending-alert-events-repository.js';
import {PermanentAlertDeliveryError, type AlertEmail, type AlertSender} from '../../protocols/mail/alert-sender.js';
import {diffViolations} from '../../../domain/services/regression.js';
import type {Impact} from '../../../domain/models/impact.js';
import type {SendAlertEmail, SendAlertEmailOutcome} from '../../../domain/usecases/send-alert-email.js';

const impactRank: Record<Impact, number> = {
  minor: 0,
  moderate: 1,
  serious: 2,
  critical: 3,
};

const pageLabel = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
};

const elementLabel = (count: number): string => `${count} ${count === 1 ? 'element' : 'elements'}`;

type WorsenedViolation = {
  current: AlertViolation;
  previous: AlertViolation | null;
};

const worsenedViolations = (delivery: AlertDelivery): WorsenedViolation[] => {
  const diff = diffViolations(delivery.current.violations, delivery.previous.violations);
  const previousByRule = new Map(delivery.previous.violations.map((violation) => [violation.ruleId, violation]));

  return [
    ...diff.added.map((current) => ({current, previous: null})),
    ...diff.unchanged.flatMap((current) => {
      const previous = previousByRule.get(current.ruleId);
      if (previous === undefined) return [];
      const impactWorsened =
        current.impact !== null &&
        (previous.impact === null || impactRank[current.impact] > impactRank[previous.impact]);
      return impactWorsened || current.nodeCount > previous.nodeCount ? [{current, previous}] : [];
    }),
  ];
};

const violationLine = ({current, previous}: WorsenedViolation): string => {
  const currentImpact = current.impact ?? 'unknown';
  const impact =
    previous !== null && previous.impact !== current.impact
      ? `${previous.impact ?? 'unknown'} → ${currentImpact}`
      : currentImpact;
  const nodes =
    previous !== null && previous.nodeCount !== current.nodeCount
      ? `${previous.nodeCount} → ${current.nodeCount} elements`
      : elementLabel(current.nodeCount);
  return `  - ${impact} — ${current.description} (${nodes})`;
};

const renderAlertEmail = (
  delivery: AlertDelivery,
  from: string,
  frontendOrigin: string,
  publicApiOrigin: string,
  unsubscribeToken: string,
): AlertEmail => {
  const label = pageLabel(delivery.pageUrl);
  const delta = delivery.previous.score - delivery.current.score;
  const unit = delta === 1 ? 'point' : 'points';
  const subject =
    delivery.kind === 'score_drop'
      ? `${label} dropped ${delta} ${unit} (${delivery.previous.score} → ${delivery.current.score})`
      : `${label} has a new serious accessibility issue ` + `(${delivery.previous.score} → ${delivery.current.score})`;
  const details = worsenedViolations(delivery);
  const detailLines =
    details.length === 0
      ? ['  - The score fell without a newly introduced or expanded rule.']
      : details.map(violationLine);
  const detailUrl = new URL(`/pages/${delivery.pageId}`, frontendOrigin);
  detailUrl.searchParams.set('audit', delivery.current.publicUuid);
  detailUrl.searchParams.set('utm_source', 'alert_email');
  const unsubscribeUrl = new URL(`/api/alerts/unsubscribe/${unsubscribeToken}`, publicApiOrigin).toString();

  return {
    from,
    to: delivery.recipient,
    subject,
    text: [
      `Your accessibility score for`,
      `  ${delivery.pageUrl}`,
      `changed from ${delivery.previous.score} to ${delivery.current.score}.`,
      '',
      `What's worse:`,
      ...detailLines,
      '',
      'See the full audit and what changed:',
      `  ${detailUrl.toString()}`,
      '',
      `Stop alerts for this page: ${unsubscribeUrl}`,
    ].join('\n'),
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    idempotencyKey: `alert-event/${delivery.eventId}`,
  };
};

export class DbSendAlertEmail implements SendAlertEmail {
  constructor(
    private readonly alerts: LoadAlertDeliveryRepository &
      MarkAlertEmailedRepository &
      ClaimAlertPreviewRepository &
      MarkAlertFailedRepository,
    private readonly sender: AlertSender,
    private readonly tokens: AlertUnsubscribeTokenCodec,
    private readonly from: string,
    private readonly frontendOrigin: string,
    private readonly publicApiOrigin: string,
    private readonly mode: AlertDispatchMode,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(alertEventId: string): Promise<SendAlertEmailOutcome> {
    const delivery = await this.alerts.loadAlertDelivery(alertEventId);
    if (
      delivery === null ||
      delivery.emailedAt !== null ||
      delivery.failedAt !== null ||
      !delivery.alertsEnabled ||
      (this.mode === 'preview' && delivery.previewedAt !== null)
    ) {
      return 'skipped';
    }

    if (this.mode === 'preview' && !(await this.alerts.claimAlertPreview(alertEventId, this.now()))) {
      return 'skipped';
    }

    const token = this.tokens.encode(delivery.pageId);
    let sendResult: Awaited<ReturnType<AlertSender['send']>>;
    try {
      sendResult = await this.sender.send(
        renderAlertEmail(delivery, this.from, this.frontendOrigin, this.publicApiOrigin, token),
      );
    } catch (error) {
      if (error instanceof PermanentAlertDeliveryError) {
        await this.alerts.markAlertFailed(alertEventId, this.now(), error.reason);
        return 'failed';
      }
      throw error;
    }
    if (sendResult === 'previewed') {
      return 'previewed';
    }
    await this.alerts.markAlertEmailed(alertEventId, this.now());
    return 'sent';
  }
}
