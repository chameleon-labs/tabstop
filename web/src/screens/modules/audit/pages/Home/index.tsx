import {useState} from 'react';
import {Link} from 'react-router';
import {useAudit, useRequestAudit} from '../../audits';
import {describeFailure} from '../../failure';
import {EXPECTED_DURATION, completionAnnouncement} from '../../phase';
import {AuditFailure} from '../../components/AuditFailure';
import {AuditStatus} from '../../components/AuditStatus';
import {AuditResult} from '../../components/AuditResult';
import {UrlField} from '../../components/UrlField';
import {useAuditPhase} from '../../hooks/use-audit-phase';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import {Landing} from './landing';

export const Home = (): React.JSX.Element => {
  useDocumentTitle('');

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const request = useRequestAudit();

  const audit = useAudit(
    request.data?.auditId,
    request.data === undefined ? {} : {pollAfterMs: request.data.pollAfterMs},
  );

  const failure = describeFailure({
    requestError: request.error,
    pollError: audit.isFetching ? null : audit.error,
    audit: audit.data,
  });
  const done = audit.data?.status === 'done';
  const waiting = failure === null && startedAt !== null && !done;

  /**
   * One sentence for the live region, covering the whole wait AND its end.
   *
   * Computed here rather than inside the progress indicator because the region
   * has to outlive that component: it unmounts the instant the audit finishes,
   * which is precisely when there is something to say.
   */
  const progressStatus = request.data === undefined ? 'submitting' : (audit.data?.status ?? request.data.status);
  const phase = useAuditPhase(progressStatus, startedAt, waiting);
  let announcement: string | null = null;
  if (done && audit.data !== undefined) {
    announcement = completionAnnouncement(audit.data.score, audit.data.violations.length);
  } else if (waiting && phase !== null) {
    announcement = `${phase}… ${EXPECTED_DURATION}`;
  }

  const submit = (url: string): void => {
    setStartedAt(Date.now());
    request.mutate(url);
  };

  /**
   * Retries the request that actually failed.
   *
   * A failed POLL asks again about the audit that already exists; anything else
   * asks for a new audit. Re-submitting after a failed poll would spend another
   * thirty seconds of Chromium, and another of the caller's rate limit, to
   * answer a question already being answered.
   *
   * `request.reset()` first, because React Query keeps the last error until the
   * next mutation settles - without it the failure stays on screen for the
   * whole retry, which looks exactly like a button that does nothing.
   */
  const retry = (): void => {
    if (failure?.source === 'poll') {
      void audit.refetch();
      return;
    }

    const url = request.variables;
    if (url === undefined) {
      return;
    }
    request.reset();
    submit(url);
  };

  /**
   * Everything that is not the form, in the slot the sample audit card
   * occupies while idle.
   *
   * `null` while nothing has been asked for, which is what keeps the sample on
   * screen: it is the illustration of the product, and it stops being an
   * illustration the moment a real audit could be mistaken for it.
   *
   * The states stay mutually exclusive, as they were when this screen was a
   * plain column. A result still showing beneath a new audit's progress reads
   * as though the new one had already finished, and moving into a hero
   * changes none of that.
   */
  const live =
    startedAt === null && failure === null ? null : (
      <>
        {failure !== null && <AuditFailure failure={failure} onRetry={retry} />}
        <AuditStatus message={announcement} />
        {failure === null && done && audit.data !== undefined && (
          <>
            <AuditResult audit={audit.data} />
            <TrackThisPage />
          </>
        )}
      </>
    );

  return <Landing urlField={<UrlField onSubmit={submit} disabled={waiting} />} live={live} />;
};

const TrackThisPage = (): React.JSX.Element => (
  <section aria-labelledby="track-heading">
    <h2 id="track-heading">Keep an eye on this page</h2>
    <p>tabstop can re-audit it every day and email you when the score drops or a new serious issue appears.</p>
    <p>
      <Link to="/signup">Track this page</Link>
    </p>
  </section>
);
