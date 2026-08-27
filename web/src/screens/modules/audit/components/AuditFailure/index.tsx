import {useId} from 'react';
import {Link} from 'react-router';
import type {DescribedFailure, FailureSource} from '../../failure';

export type AuditFailureProps = {
  failure: DescribedFailure;
  onRetry?: (() => void) | undefined;
  headingLevel?: 1 | 2;
};

const HEADINGS: Readonly<Record<FailureSource, string>> = {
  request: 'That audit could not be started',
  poll: 'Lost track of that audit',
  audit: 'That audit did not finish',
};

const SIGNUP_HEADING = 'You have used your free audits';

export const AuditFailure = ({failure, onRetry, headingLevel = 2}: AuditFailureProps): React.JSX.Element => {
  const headingId = useId();
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <section role="alert" aria-labelledby={headingId}>
      <Heading id={headingId}>{failure.action === 'signup' ? SIGNUP_HEADING : HEADINGS[failure.source]}</Heading>
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

const RateLimitOffer = ({failure}: {failure: DescribedFailure}): React.JSX.Element => (
  <>
    <p>Create an account to keep auditing, and to track pages over time.</p>
    <p>
      <Link to="/signup">Create an account</Link>
    </p>
    {failure.rateLimit === undefined ? null : <p>Or wait {failure.rateLimit.retryAfter} seconds and try again.</p>}
  </>
);
