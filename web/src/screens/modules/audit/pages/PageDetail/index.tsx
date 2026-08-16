import {
  Badge,
  Button,
  Callout,
  Card,
  LiveRegion,
  SegmentedControl,
  SegmentedControlItem,
  VisuallyHidden,
} from '@chameleon-labs/lattice-react';
import {useId, useRef, useState} from 'react';
import {Link, useNavigate, useParams, useSearchParams} from 'react-router';
import type {Impact, PageSummary} from '@tabstop/contract';
import {isApiError} from '@/api/client';
import {AlertCircle} from '@/screens/components/Icons';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import {AuditList} from '../../components/AuditList';
import {AuditPanel} from '../../components/AuditPanel';
import {DeletePageDialog} from '../../components/DeletePageDialog';
import {HistoryTable} from '../../components/HistoryTable';
import {ScoreDelta} from '../../components/ScoreDelta';
import {TrendChart} from '../../components/TrendChart';
import {dashboardRowState} from '../../dashboard-row';
import {IMPACT_LABELS} from '../../grouping';
import {useDeleteMonitoredPage, useMonitoredPages, useSetPageMonitoring} from '../../monitored-pages';
import {HISTORY_WINDOWS, historyWindowFrom, usePageHistory} from '../../page-history';
import {exactTime, pageTimestamp, relativeTime} from '../../page-time';
import {hostOf} from '../../url';
import './page-detail.css';

const COUNT_ORDER: readonly Impact[] = ['critical', 'serious', 'moderate', 'minor'];

type RemovalTarget = {page: PageSummary; trigger: HTMLElement | null};

export const PageDetail = (): React.JSX.Element => {
  const {id} = useParams<{id: string}>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const days = historyWindowFrom(params.get('days'));
  const selectedAuditId = params.get('audit');
  const asTable = params.get('view') === 'table';

  // Identity, the controls and the summary come from the dashboard's own query,
  // which is warm on arrival from it. The history response carries no domain and
  // no monitoring flag, so a second source for them would be a second answer.
  const pages = useMonitoredPages();
  const page = pages.data?.pages.find((candidate) => candidate.id === id);
  const history = usePageHistory(id, days);
  const monitoring = useSetPageMonitoring();
  const deletePage = useDeleteMonitoredPage();

  const [announcement, setAnnouncement] = useState('');
  const [removal, setRemoval] = useState<RemovalTarget | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const trendHeadingId = useId();
  const auditsHeadingId = useId();

  const url = page?.url ?? history.data?.url;
  const domain = url === undefined ? null : hostOf(url);
  const points = history.data?.points ?? [];
  const missing = isApiError(history.error) && history.error.status === 404;
  const heading = domain ?? (missing ? 'Page not found' : 'Page');
  useDocumentTitle(heading);
  const latestAuditId = page?.latestAudit?.auditId ?? null;
  const timestamp = page === undefined ? null : pageTimestamp(page);
  // The dashboard's own reading of the same row, so one screen cannot describe
  // a retained score differently from the other.
  const rowState = page === undefined ? null : dashboardRowState(page);
  const latestCounts = page?.latestAudit?.status === 'done' ? page.latestAudit.countsByImpact : null;
  const monitoringVerb = page?.monitoringEnabled === false ? 'Resume' : 'Pause';
  const now = Date.now();

  const setWindow = (next: string): void => {
    // Replaced, not pushed: changing a view is not a navigation, and Back
    // should leave the page rather than undo a choice of window.
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.set('days', next);
        return updated;
      },
      {replace: true},
    );
  };

  const setView = (): void => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        if (asTable) {
          updated.delete('view');
        } else {
          updated.set('view', 'table');
        }
        return updated;
      },
      {replace: true},
    );
  };

  const openAudit = (auditId: string): void => {
    // Pushed, which is the whole reason the open audit lives in the url: Back
    // closes the panel.
    setParams((current) => {
      const updated = new URLSearchParams(current);
      updated.set('audit', auditId);
      return updated;
    });
  };

  const closeAudit = (): void => {
    setParams(
      (current) => {
        const updated = new URLSearchParams(current);
        updated.delete('audit');
        return updated;
      },
      {replace: true},
    );
  };

  const toggleMonitoring = (target: PageSummary): void => {
    const next = !target.monitoringEnabled;
    setControlError(null);

    monitoring.mutate(
      {pageId: target.id, monitoringEnabled: next},
      {
        onSuccess: () => {
          setAnnouncement(`Monitoring ${next ? 'resumed' : 'paused'} for ${target.url}`);
        },
        onError: (error) => {
          const message = `Could not ${next ? 'resume' : 'pause'} monitoring for ${target.url}. ${error.message}`;
          setControlError(message);
          setAnnouncement(message);
        },
      },
    );
  };

  const confirmRemoval = async (target: PageSummary): Promise<boolean> => {
    setRemovalError(null);

    try {
      await deletePage.mutateAsync({pageId: target.id});
      void navigate('/dashboard');

      return true;
    } catch (caught) {
      const message = `Could not remove ${target.url}. ${caught instanceof Error ? caught.message : ''}`.trim();
      setRemovalError(message);

      return false;
    }
  };

  return (
    <section className="page-detail">
      <nav className="page-detail__breadcrumb" aria-label="Breadcrumb">
        <Link to="/dashboard">Your pages</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{heading}</span>
      </nav>

      <header className="page-detail__header">
        <div className="page-detail__identity">
          <h1 className="page-detail__title">{heading}</h1>
          {url !== undefined && <p className="page-detail__url">{url}</p>}
          {page?.monitoringEnabled === false && <Badge variant="default">Paused</Badge>}
        </div>
        {page !== undefined && (
          <div className="page-detail__actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={monitoring.isPending}
              aria-label={`${monitoringVerb} monitoring for ${page.url}`}
              onClick={() => {
                toggleMonitoring(page);
              }}
            >
              {monitoringVerb}
            </Button>
            <Button
              ref={removeRef}
              variant="ghost"
              size="sm"
              aria-label={`Remove ${page.url}`}
              onClick={() => {
                setRemoval({page, trigger: removeRef.current});
              }}
            >
              Remove
            </Button>
          </div>
        )}
      </header>

      {controlError !== null && (
        <Callout variant="danger" icon={<AlertCircle size="sm" />} title="Could not change monitoring">
          <p>{controlError}</p>
        </Callout>
      )}

      {/* The summary and both controls come from the list query, so its failure
          removes them from the screen. Said out loud rather than left as a gap
          the reader has to interpret; the trend is a separate query and stays. */}
      {pages.data === undefined && pages.error !== null && (
        <Callout variant="danger" icon={<AlertCircle size="sm" />} title="Could not load this page's details">
          <p>{`The score summary and the page controls are unavailable. ${pages.error.message}`}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void pages.refetch();
            }}
          >
            Retry details
          </Button>
        </Callout>
      )}

      {page !== undefined && timestamp !== null && rowState !== null && (
        <Card className="page-detail__summary">
          <div className="page-detail__score">
            {rowState.showScore && page.score !== null ? (
              <>
                <p className="page-detail__score-value">
                  <VisuallyHidden>{`${rowState.scoreLabel ?? 'Score'} ${page.score} out of 100`}</VisuallyHidden>
                  <span aria-hidden="true">{page.score}</span>
                  <span className="page-detail__score-max" aria-hidden="true">
                    /100
                  </span>
                </p>
                {rowState.showDelta && <ScoreDelta score={page.score} previousScore={page.previousScore} />}
                {rowState.scoreLabel !== null && (
                  <span className="page-detail__score-label" aria-hidden="true">
                    {rowState.scoreLabel}
                  </span>
                )}
              </>
            ) : (
              <p className="page-detail__unscored">Not scored yet</p>
            )}
          </div>

          {/* Only when the run that produced the score is also the latest one.
              `page.score` is the most recent COMPLETED score, so after a failed
              or in-flight re-audit these counts belong to a different run. */}
          {latestCounts !== null && (
            <dl className="page-detail__counts">
              {COUNT_ORDER.map((impact) => (
                <div key={impact} className="page-detail__count" data-impact={impact}>
                  <dt>{IMPACT_LABELS[impact]}</dt>
                  <dd>{latestCounts[impact]}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="page-detail__latest">
            <time
              className="page-detail__time"
              dateTime={timestamp.value}
              aria-label={`${timestamp.prefix} ${exactTime(timestamp.value)}`}
            >
              {`${timestamp.prefix} ${relativeTime(timestamp.value, now)}`}
            </time>
            {latestAuditId !== null && (
              <Button
                variant="secondary"
                size="sm"
                aria-label="View the latest result"
                onClick={() => {
                  openAudit(latestAuditId);
                }}
              >
                View result
              </Button>
            )}
          </div>
        </Card>
      )}

      {missing ? (
        <Callout variant="warning" icon={<AlertCircle size="sm" />}>
          <p>This is not one of your monitored pages. It may have been removed, or it belongs to another account.</p>
          <Button variant="secondary" size="sm" render={<Link to="/dashboard" />}>
            Back to your pages
          </Button>
        </Callout>
      ) : (
        <>
          <section className="page-detail__trend" aria-labelledby={trendHeadingId} aria-busy={history.isPending}>
            <div className="page-detail__section-header">
              <h2 className="page-detail__section-heading" id={trendHeadingId}>
                Score trend
              </h2>
              <div className="page-detail__view-controls">
                <SegmentedControl aria-label="Trend window" value={String(days)} setValue={setWindow}>
                  {HISTORY_WINDOWS.map((window) => (
                    <SegmentedControlItem key={window} value={String(window)}>
                      {`${window} days`}
                    </SegmentedControlItem>
                  ))}
                </SegmentedControl>
                <Button variant="secondary" size="sm" aria-pressed={asTable} onClick={setView}>
                  View as table
                </Button>
              </div>
            </div>

            {history.isPending && <p className="page-detail__loading">Loading the score history…</p>}

            {history.error !== null && (
              <Callout variant="danger" icon={<AlertCircle size="sm" />} title="Could not load the score history">
                <p>{history.error.message}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void history.refetch();
                  }}
                >
                  Retry
                </Button>
              </Callout>
            )}

            {history.data !== undefined &&
              (asTable ? (
                <HistoryTable points={points} domain={domain ?? ''} days={days} />
              ) : (
                <TrendChart points={points} onFocusPoint={setAnnouncement} />
              ))}
          </section>

          {/* Hidden while there is nothing to list: the trend above already says the window is empty, and saying it twice reads as a fault. */}
          {points.length > 0 && (
            <section className="page-detail__audits" aria-labelledby={auditsHeadingId}>
              <h2 className="page-detail__section-heading" id={auditsHeadingId}>
                Audits
              </h2>
              <AuditList points={points} selectedAuditId={selectedAuditId} onSelect={openAudit} />
            </section>
          )}

          {selectedAuditId !== null && <AuditPanel auditId={selectedAuditId} onClose={closeAudit} />}
        </>
      )}

      <LiveRegion message={announcement} />

      <DeletePageDialog
        open={removal !== null}
        target={removal?.page ?? null}
        trigger={removal?.trigger ?? null}
        error={removalError}
        onOpenChange={(next) => {
          if (!next) {
            setRemoval(null);
            setRemovalError(null);
          }
        }}
        onConfirm={confirmRemoval}
      />
    </section>
  );
};
