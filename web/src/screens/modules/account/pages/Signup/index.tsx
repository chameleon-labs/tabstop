import { useDocumentTitle } from '@/screens/hooks/use-document-title'

/**
 * Placeholder, and it exists now because #19 links here.
 *
 * The 429 offer is the product's best conversion moment - someone who has
 * audited enough pages to exhaust the anonymous limit - and it pointed at a
 * route that did not exist, so the most motivated visitor the product will ever
 * see landed on a 404. A placeholder that says what is coming is a poor
 * destination; a 404 is a broken one.
 *
 * The real screen needs its own issue: account creation, the #10 session
 * cookie, and the "track this page" flow that carries the audited URL through
 * signup so it is not retyped.
 */
export const Signup = (): React.JSX.Element => {
  useDocumentTitle('Create an account')

  return (
    <section>
      <h1>Create an account</h1>
      <p>Accounts are not open yet. Audits stay free and anonymous in the meantime.</p>
    </section>
  )
}
