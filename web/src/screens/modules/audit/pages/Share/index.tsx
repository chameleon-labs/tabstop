import type {AuditResultResponse} from '@tabstop/contract';
import type {UseQueryResult} from '@tanstack/react-query';
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
import {useStartAudit} from '../../hooks/use-start-audit';
import {EXPECTED_DURATION, completionAnnouncement} from '../../phase';
import {shareUrlFor, startedHereFrom} from '../../share';
import {hostOf} from '../../url';
import './share.css';

export const Share = (): React.JSX.Element => {
  const {uuid} = useParams<{uuid: string}>();
  const location = useLocation();
  const audit = useAudit(uuid);

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

  const done = data?.status === 'done';
  const waiting = failure === null && data !== undefined && !done;

  const reasking = data === undefined && audit.isFetching && audit.errorUpdateCount > 0;

  const phase = useAuditPhase(
    data?.status ?? 'queued',
    data === undefined ? null : Date.parse(data.createdAt),
    waiting,
  );

  let announcement: string | null = null;
  if (reasking) {
    announcement = 'Looking for that audit…';
  } else if (waiting && phase !== null) {
    announcement = `${phase}… ${EXPECTED_DURATION}`;
  } else if (done && owner && data !== undefined) {
    announcement = completionAnnouncement(data.score, data.violations.length);
  }

  return (
    <div className="report-page">
      <ReportHeader audit={data} auditId={auditId} />
      <AuditStatus message={announcement} />
      {failure !== null && <ReportFailure failure={failure} audit={audit} owner={owner} />}
      {waiting && data !== undefined && <AuditProgress status={data.status} phase={phase} />}
      {done && data !== undefined && <AuditResult audit={data} />}
      {owner ? <TrackThisPage url={data?.url} /> : <CheckYourOwnSite />}
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
  const {start} = useStartAudit();
  const url = audit.data?.url;

  if (failure === null) {
    return null;
  }

  let retry: (() => void) | undefined;
  if (failure.source === 'poll') {
    retry = (): void => {
      void audit.refetch();
    };
  } else if (failure.source === 'audit' && owner && url !== undefined) {
    retry = (): void => {
      start(url);
    };
  }

  return <AuditFailure failure={failure} onRetry={retry} />;
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
    <p>
      <Link to="/signup">Track this page</Link>
    </p>
  </section>
);
