import { useState } from 'react'
import { useAudit, useRequestAudit } from '../../api/audits'
import { describeFailure } from '../../audit/failure'
import { AuditFailure } from '../../components/AuditFailure'
import { AuditProgress } from '../../components/AuditProgress'
import { AuditResult } from '../../components/AuditResult'
import { UrlField } from '../../components/UrlField'
import { useDocumentTitle } from '../../hooks/use-document-title'

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
  useDocumentTitle('')

  const [startedAt, setStartedAt] = useState<number | null>(null)
  const request = useRequestAudit()

  // The audit id only exists after the POST is accepted, and `pollAfterMs`
  // comes with it - passed through rather than chosen here, so the server can
  // widen the interval without a frontend deploy.
  const audit = useAudit(
    request.data?.auditId,
    request.data === undefined ? {} : { pollAfterMs: request.data.pollAfterMs }
  )

  const failure = describeFailure({
    requestError: request.error,
    // No `isFetching` guard here, unlike `request.reset()` on the mutation
    // above, and the asymmetry is real rather than an oversight: React Query
    // CLEARS a query's error when a refetch begins, while it keeps a mutation's
    // until the next one settles. Measured, not assumed - a guard was written
    // here first and no mutation of it changed any observable behaviour.
    // `Home/index.spec.tsx` holds a refetch open and asserts the failure is
    // already gone, so a future version that starts retaining query errors
    // fails that spec instead of quietly stranding a "Try again" button.
    pollError: audit.error,
    audit: audit.data
  })
  const done = audit.data?.status === 'done'
  const waiting = failure === null && startedAt !== null && !done

  const submit = (url: string): void => {
    setStartedAt(Date.now())
    request.mutate(url)
  }

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
      void audit.refetch()
      return
    }

    const url = request.variables
    if (url === undefined) return
    request.reset()
    submit(url)
  }

  return (
    <>
      <section aria-labelledby="home-heading">
        <h1 id="home-heading">Paste a URL, get an accessibility audit</h1>
        <p>
          Audits run real Chromium with the same engine behind most accessibility
          tooling. No signup, no setup.
        </p>
        <UrlField onSubmit={submit} disabled={waiting} />
      </section>

      {failure !== null && <AuditFailure failure={failure} onRetry={retry} />}

      {waiting && startedAt !== null && (
        <AuditProgress
          // `submitting` until the server has accepted anything. Falling back
          // to 'queued' claimed a place in a queue the request had not reached
          // and might never reach - a slow or refused POST announced a phase
          // that was never true. After acceptance the server's own answer is
          // used until the first poll returns, rather than a guess.
          status={
            request.data === undefined ? 'submitting' : audit.data?.status ?? request.data.status
          }
          startedAt={startedAt}
        />
      )}

      {failure === null && done && audit.data !== undefined && (
        <AuditResult audit={audit.data} />
      )}
    </>
  )
}
