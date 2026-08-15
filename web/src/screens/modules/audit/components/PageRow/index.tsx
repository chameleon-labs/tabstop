import {Badge, Button, Card} from '@chameleon-labs/lattice-react';
import {useRef} from 'react';
import {Link} from 'react-router';
import type {PageSummary} from '@tabstop/contract';
import type {ToastInput} from '@/screens/components/ToastRegion';
import {dashboardRowState} from '../../dashboard-row';
import {useAuditPhase} from '../../hooks/use-audit-phase';
import {useSetPageMonitoring} from '../../monitored-pages';
import {exactTime, pageTimestamp, relativeTime} from '../../page-time';
import {ScoreDelta} from '../ScoreDelta';
import {Sparkline} from '../Sparkline';
import './page-row.css';

export type PageRowProps = {
  page: PageSummary;
  now: number;
  onToast: (toast: ToastInput) => void;
  onRequestRemove: (page: PageSummary, trigger: HTMLButtonElement) => void;
};

export const PageRow = ({page, now, onToast, onRequestRemove}: PageRowProps): React.JSX.Element => {
  const state = dashboardRowState(page);
  const timestamp = pageTimestamp(page);
  const removeRef = useRef<HTMLButtonElement>(null);
  const monitoring = useSetPageMonitoring();

  const latestStatus = page.latestAudit?.status ?? 'done';
  const phase = useAuditPhase(
    latestStatus,
    page.latestAudit === null ? null : Date.parse(page.latestAudit.createdAt),
    state.inFlightPrefix !== null,
  );

  const toggleMonitoring = (): void => {
    const next = !page.monitoringEnabled;
    monitoring.mutate(
      {pageId: page.id, monitoringEnabled: next},
      {
        onSuccess: () => {
          onToast({
            variant: 'success',
            message: `Monitoring ${next ? 'resumed' : 'paused'} for ${page.url}`,
          });
        },
        onError: (error) => {
          onToast({
            variant: 'danger',
            message: `Could not ${next ? 'resume' : 'pause'} monitoring for ${page.url}. ${error.message}`,
          });
        },
      },
    );
  };

  const monitoringLabel = page.monitoringEnabled ? 'Pause' : 'Resume';
  const pendingLabel = page.monitoringEnabled ? 'Pausing' : 'Resuming';
  const actionName = `${monitoring.isPending ? pendingLabel : monitoringLabel} monitoring for ${page.url}`;

  return (
    <li className="page-row" data-state={state.kind}>
      <Card className="page-row__card">
        <div className="page-row__identity">
          <Link
            className="page-row__link"
            to={`/pages/${encodeURIComponent(page.id)}`}
            aria-label={`View details for ${page.url}`}
          >
            <span className="page-row__domain">{page.domain}</span>
            <span className="page-row__url">{page.url}</span>
          </Link>
        </div>

        <div className="page-row__metrics">
          {state.showScore && page.score !== null && (
            <p className="page-row__score" aria-label={`${state.scoreLabel} ${page.score} out of 100`}>
              {page.score}
            </p>
          )}
          {state.showDelta && page.score !== null && (
            <ScoreDelta score={page.score} previousScore={page.previousScore} />
          )}
          {state.scoreLabel !== null && state.showScore && (
            <span className="page-row__score-label" aria-hidden="true">
              {state.scoreLabel}
            </span>
          )}
        </div>

        <div className="page-row__trend">
          {state.showTrend && <Sparkline points={page.history} className="page-row__sparkline" />}
        </div>

        <div className="page-row__meta">
          {state.kind === 'paused' && <Badge variant="default">Paused</Badge>}
          {state.kind === 'failed' && (
            <p className="page-row__status page-row__status--failed">
              Audit failed{page.latestAudit?.error === null ? '' : `: ${page.latestAudit?.error ?? ''}`}
            </p>
          )}
          {state.kind === 'unstarted' && (
            <p className="page-row__status page-row__status--failed">
              The first audit could not start. Monitoring will try again on its normal schedule.
            </p>
          )}
          {state.inFlightPrefix !== null && phase !== null && (
            <p className="page-row__status page-row__status--running">{`${state.inFlightPrefix}: ${phase}…`}</p>
          )}
          <time
            className="page-row__time"
            dateTime={timestamp.value}
            aria-label={`${timestamp.prefix} ${exactTime(timestamp.value)}`}
          >
            {`${timestamp.prefix} ${relativeTime(timestamp.value, now)}`}
          </time>
        </div>

        <div className="page-row__actions">
          <Button
            variant="ghost"
            size="sm"
            disabled={monitoring.isPending}
            aria-label={actionName}
            onClick={toggleMonitoring}
          >
            {monitoring.isPending ? `${pendingLabel}…` : monitoringLabel}
          </Button>
          <Button
            ref={removeRef}
            variant="ghost"
            size="sm"
            aria-label={`Remove ${page.url}`}
            onClick={() => {
              if (removeRef.current !== null) {
                onRequestRemove(page, removeRef.current);
              }
            }}
          >
            Remove
          </Button>
        </div>
      </Card>
    </li>
  );
};
