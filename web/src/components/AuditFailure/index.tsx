import { Link } from 'react-router'
import type { DescribedFailure } from '../../audit/failure'

export type AuditFailureProps = {
  failure: DescribedFailure
  onRetry: () => void
}

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
export const AuditFailure = ({ failure, onRetry }: AuditFailureProps): React.JSX.Element => (
  <section role="alert" aria-labelledby="audit-failure-heading">
    <h2 id="audit-failure-heading">
      {failure.action === 'signup' ? 'You have used your free audits' : 'That audit did not finish'}
    </h2>

    <p>{failure.message}</p>

    {failure.action === 'retry' && (
      <button type="button" onClick={onRetry}>Try again</button>
    )}

    {failure.action === 'check-url' && (
      <p>Check the address and try a different one.</p>
    )}

    {failure.action === 'signup' && <RateLimitOffer failure={failure} />}
  </section>
)

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
const RateLimitOffer = ({ failure }: { failure: DescribedFailure }): React.JSX.Element => (
  <>
    <p>Create an account to keep auditing, and to track pages over time.</p>
    <p><Link to="/signup">Create an account</Link></p>
    {failure.rateLimit === undefined
      ? null
      : <p>Or wait {failure.rateLimit.retryAfter} seconds and try again.</p>}
  </>
)
