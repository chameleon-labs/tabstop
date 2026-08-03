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

  const failure = describeFailure(request.error, audit.data)
  const done = audit.data?.status === 'done'
  const waiting = failure === null && startedAt !== null && !done

  const submit = (url: string): void => {
    setStartedAt(Date.now())
    request.mutate(url)
  }

  /**
   * Re-submits the URL that failed, rather than asking for it again.
   *
   * `request.reset()` first because React Query keeps the last error until the
   * next mutation settles; without it the failure stays on screen through the
   * whole of the retry, which looks exactly like a button that does nothing.
   */
  const retry = (): void => {
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
        <AuditProgress status={audit.data?.status ?? 'queued'} startedAt={startedAt} />
      )}

      {failure === null && done && audit.data !== undefined && (
        <AuditResult audit={audit.data} />
      )}
    </>
  )
}
