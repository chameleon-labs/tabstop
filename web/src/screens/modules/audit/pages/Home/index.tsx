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

/**
 * The product's entire hook: paste a URL, wait, get something worth sharing.
 * No signup. If this screen is not good, nothing downstream matters.
 *
 * Three states, one at a time - the form, the wait, the answer - and a failure
 * can replace any of them. Mutually exclusive on purpose: a previous result
 * still showing beneath a new audit's progress reads as though the new one had
 * already finished.
 */
export const Home = (): React.JSX.Element => {
  useDocumentTitle('');

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const request = useRequestAudit();

  // The audit id only exists after the POST is accepted, and `pollAfterMs`
  // comes with it - passed through rather than chosen here, so the server can
  // widen the interval without a frontend deploy.
  const audit = useAudit(
    request.data?.auditId,
    request.data === undefined ? {} : {pollAfterMs: request.data.pollAfterMs},
  );

  const failure = describeFailure({
    requestError: request.error,
    // Suppressed while a refetch is in flight, and this depends on whether the
    // query has CACHED DATA - which is why it took three attempts to get right.
    //
    // With no data, React Query clears `error` when a refetch begins, so the
    // guard changes nothing and a spec covering only that path shows no
    // difference. With data retained from an earlier successful poll - the
    // ordinary case, since polling succeeds before it fails - the error
    // survives until the new request settles. Measured at this screen rather
    // than in the library: the failure panel and its own "Try again" button
    // stayed on screen for the whole flight, which is exactly the "button did
    // nothing" shape `request.reset()` prevents on the mutation side.
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
  const announcement =
    done && audit.data !== undefined
      ? completionAnnouncement(audit.data.score, audit.data.violations.length)
      : waiting && phase !== null
        ? `${phase}… ${EXPECTED_DURATION}`
        : null;

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
    if (url === undefined) return;
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

        {/*
          ALWAYS mounted once anything has been asked for, and empty until
          there is something to say. A region whose content is present when it
          appears is initial content, announced by nothing - and one that
          unmounts when the audit ends cannot announce that it ended.
        */}
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

/**
 * The signup CTA, and it lives HERE rather than inside `AuditResult`.
 *
 * That component is rendered by the share page (#23) and audit detail (#21) as
 * well, where the ask is wrong: someone following a link a colleague sent has
 * no page of their own in mind yet, and someone already signed in is being
 * offered an account. The screen that knows the context owns the framing.
 *
 * Sells the monitoring rather than the signup - the audit they just ran is
 * already free, so the reason to have an account is what happens tomorrow.
 */
const TrackThisPage = (): React.JSX.Element => (
  <section aria-labelledby="track-heading">
    <h2 id="track-heading">Keep an eye on this page</h2>
    <p>tabstop can re-audit it every day and email you when the score drops or a new serious issue appears.</p>
    <p>
      <Link to="/signup">Track this page</Link>
    </p>
  </section>
);
