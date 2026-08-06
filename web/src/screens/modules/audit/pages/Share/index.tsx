import { useParams } from 'react-router'
import { useDocumentTitle } from '@/screens/hooks/use-document-title'

/**
 * Placeholder. The public result page is #23.
 *
 * Unauthenticated and outside `RequireAuth` by design: the uuid is the only
 * credential, and requiring a session here would defeat the point of a link
 * someone can send to a colleague.
 */
export const Share = (): React.JSX.Element => {
  const { uuid } = useParams<{ uuid: string }>()
  useDocumentTitle('Audit result')

  return (
    <section>
      <h1>Audit result</h1>
      <p>The public result page for {uuid} lands in #23.</p>
    </section>
  )
}
