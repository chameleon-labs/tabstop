import type {AuditResultResponse} from '@tabstop/contract';
import type {UseQueryResult} from '@tanstack/react-query';
import {Button} from '@chameleon-labs/lattice-react';
import {Link, useLocation, useParams} from 'react-router';
import {isApiError} from '@/api/client';
import {NotFound} from '@/screens/components/NotFound';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import {useAudit} from '../../audits';
import {AuditFailure} from '../../components/AuditFailure';
import {AuditProgress} from '../../components/AuditProgress';
import {AuditResult} from '../../components/AuditResult';
import {AuditStatus} from '../../components/AuditStatus';
import {CopyLink} from '../../components/CopyLink';
import {UrlField} from '../../components/UrlField';
import {describeFailure} from '../../failure';
import {useAuditPhase} from '../../hooks/use-audit-phase';
import {useAuditPresentation} from '../../hooks/use-audit-presentation';
import {useStartAudit} from '../../hooks/use-start-audit';
import {EXPECTED_DURATION, completionAnnouncement} from '../../phase';
import {pollAfterMsFrom, shareUrlFor, startedHereFrom} from '../../share';
import {hostOf} from '../../url';
import './share.css';

export const Share = (): React.JSX.Element => {
  const {uuid} = useParams<{uuid: string}>();
  const location = useLocation();
  const audit = useAudit(uuid, {pollAfterMs: pollAfterMsFrom(location.state)});

  if (isApiError(audit.error) && audit.error.status === 404) {
    return <NotFound />;
  }

  return <SharedReport auditId={uuid ?? ''} audit={audit} owner={startedHereFrom(location.state)} />;
};

type SharedReportProps = {
  auditId: string;
  audit: UseQueryResult<AuditResultResponse, Error>;
  owner: boolean;
};

const SharedReport = ({auditId, audit, owner}: SharedReportProps): React.JSX.Element => {
  useDocumentTitle('Audit result');

  const {data} = audit;
  const failure = describeFailure({
    requestError: null,
    pollError: audit.isFetching ? null : audit.error,
    audit: data,
  });

  const phaseActive = failure === null && (data === undefined || data.status === 'queued' || data.status === 'running');
  const phase = useAuditPhase(
    data?.status ?? 'queued',
    data === undefined ? null : Date.parse(data.createdAt),
    phaseActive,
  );
  const presentation = useAuditPresentation({
    auditId,
    status: data?.status,
    phase,
    owner,
    failure: failure !== null,
  });

  const focused = presentation.view === 'progress' || presentation.view === 'exiting';
  const completed = presentation.view === 'report' && data?.status === 'done';

  let announcement: string | null = null;
  if (failure === null && data === undefined && audit.isFetching) {
    announcement = 'Looking for that audit…';
  } else if (
    failure === null &&
    focused &&
    (data?.status === 'queued' || data?.status === 'running') &&
    phase !== null
  ) {
    announcement = `${phase}… ${EXPECTED_DURATION}`;
  } else if (completed && presentation.completedInSession && data !== undefined) {
    announcement = completionAnnouncement(data.score, data.violations.length);
  }
  const visibleMessage = focused ? presentation.headline : announcement;

  return (
    <div className="report-page" data-view={presentation.view}>
      {focused && (
        <>
          <h1 className="visually-hidden">Audit in progress</h1>
          <p className="report-page__progress-eyebrow" aria-hidden="true">
            Audit in progress
          </p>
        </>
      )}
      <AuditStatus message={announcement} visibleMessage={visibleMessage} />
      {focused && (
        <div className="report-page__progress-body">
          <p className="report-page__progress-duration">{EXPECTED_DURATION}</p>
          {data?.url === undefined ? null : <p className="report-page__progress-url">{data.url}</p>}
          <AuditProgress phase={presentation.phase} complete={presentation.complete} />
        </div>
      )}
      {presentation.view === 'failure' && failure !== null && (
        <ReportFailure failure={failure} audit={audit} owner={owner} />
      )}
      {completed && data !== undefined && (
        <>
          <ReportHeader audit={data} auditId={auditId} />
          <AuditResult audit={data} />
          {owner ? <TrackThisPage url={data.url} /> : <CheckYourOwnSite />}
        </>
      )}
    </div>
  );
};

const ReportHeader = ({
  audit,
  auditId,
}: {
  audit: AuditResultResponse | undefined;
  auditId: string;
}): React.JSX.Element => (
  <header className="report-page__header">
    <div className="report-page__identity">
      <h1 className="report-page__host">{audit === undefined ? 'Accessibility report' : hostOf(audit.url)}</h1>
      {audit === undefined ? null : (
        <>
          <p className="report-page__url">{audit.url}</p>
          <p className="report-page__meta">
            <span>Audited {new Date(audit.createdAt).toLocaleDateString()}</span>
            {audit.axeVersion === null ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>axe-core {audit.axeVersion}</span>
              </>
            )}
          </p>
        </>
      )}
    </div>
    <CopyLink url={shareUrlFor(auditId, window.location.origin)} />
  </header>
);

type ReportFailureProps = {
  failure: ReturnType<typeof describeFailure>;
  audit: UseQueryResult<AuditResultResponse, Error>;
  owner: boolean;
};

const ReportFailure = ({failure, audit, owner}: ReportFailureProps): React.JSX.Element | null => {
  const reaudit = useStartAudit();
  const url = audit.data?.url;

  if (failure === null) {
    return null;
  }

  let retry: (() => void) | undefined;
  if (failure.source === 'poll') {
    retry = (): void => {
      void audit.refetch();
    };
  } else if (
    failure.source === 'audit' &&
    owner &&
    url !== undefined &&
    !reaudit.isPending &&
    reaudit.failure === null
  ) {
    retry = (): void => {
      reaudit.start(url);
    };
  }

  return (
    <>
      <AuditFailure failure={failure} onRetry={retry} />
      {reaudit.failure !== null && <AuditFailure failure={reaudit.failure} onRetry={reaudit.retry} />}
    </>
  );
};

const CheckYourOwnSite = (): React.JSX.Element => {
  const {start, retry, failure, isPending} = useStartAudit();

  return (
    <section className="report-page__cta" aria-labelledby="check-your-own-heading">
      <h2 id="check-your-own-heading">Check your own site</h2>
      <p>tabstop checks any page for accessibility problems. Paste your own to get a score like this one.</p>
      {failure !== null && <AuditFailure failure={failure} onRetry={retry} />}
      <UrlField onSubmit={start} disabled={isPending} />
    </section>
  );
};

const TrackThisPage = ({url}: {url: string | undefined}): React.JSX.Element => (
  <section className="report-page__cta" aria-labelledby="track-heading">
    <h2 id="track-heading">Keep an eye on this page</h2>
    <p>
      tabstop can re-audit {url === undefined ? 'it' : hostOf(url)} every day and email you when the score drops or a
      new serious issue appears.
    </p>
    <Button variant="primary" size="sm" render={<Link to="/signup" />}>
      Track this page
    </Button>
  </section>
);
