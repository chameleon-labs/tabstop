import {useId} from 'react';
import {Link} from 'react-router';
import type {DescribedFailure, FailureSource} from '../../failure';

export type AuditFailureProps = {
  failure: DescribedFailure;
  /** Absent where there is nothing to retry, as on a share link someone else made. */
  onRetry?: (() => void) | undefined;
};

/**
 * One heading per source, because "That audit did not finish" is false for two
 * of the three.
 *
 * A refused REQUEST means no audit was ever started - there is nothing that
 * could have finished. A failed POLL means the audit may well still be running
 * and only the question about it failed; telling someone their audit did not
 * finish, when it might be finishing right now, is worse than vague.
 *
 * Only `audit` describes a run that reached a terminal failed state.
 */
const HEADINGS: Readonly<Record<FailureSource, string>> = {
  request: 'That audit could not be started',
  poll: 'Lost track of that audit',
  audit: 'That audit did not finish',
};

/** The rate limit is not a failure, so it does not take a failure's heading. */
const SIGNUP_HEADING = 'You have used your free audits';

/**
 * A failure, and the one thing worth doing about it.
 *
 * The sentence comes from the server - eight of them exist there, written for a
 * person - and this component decides only what to offer beside it. That split
 * is why there is no message table here.
 *
 * `role="alert"` because this replaces something the reader was waiting on. It
 * is the one place in this flow where interrupting is correct: they asked a
 * question thirty seconds ago and the answer is that it failed.
 */
export const AuditFailure = ({failure, onRetry}: AuditFailureProps): React.JSX.Element => {
  const headingId = useId();

  return (
    <section role="alert" aria-labelledby={headingId}>
      <h2 id={headingId}>{failure.action === 'signup' ? SIGNUP_HEADING : HEADINGS[failure.source]}</h2>
      <p>{failure.message}</p>
      {failure.action === 'retry' && onRetry !== undefined && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
      {failure.action === 'check-url' && <p>Check the address and try a different one.</p>}
      {failure.action === 'signup' && <RateLimitOffer failure={failure} />}
    </section>
  );
};

/**
 * The conversion moment, and it is deliberately not styled as an error above.
 *
 * Someone who has audited enough pages to exhaust the anonymous limit has
 * demonstrated the product's value more convincingly than any landing page
 * could. Treating that as a failure - red, apologetic - would be the single
 * most expensive piece of copy in the app.
 *
 * The wait is still shown. An offer that hides when they could simply try again
 * is a dark pattern, and this product cannot afford one.
 */
const RateLimitOffer = ({failure}: {failure: DescribedFailure}): React.JSX.Element => (
  <>
    <p>Create an account to keep auditing, and to track pages over time.</p>
    <p>
      <Link to="/signup">Create an account</Link>
    </p>
    {failure.rateLimit === undefined ? null : <p>Or wait {failure.rateLimit.retryAfter} seconds and try again.</p>}
  </>
);
