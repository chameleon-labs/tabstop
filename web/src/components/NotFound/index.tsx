import { Link } from 'react-router'
import { useDocumentTitle } from '../../hooks/use-document-title'

export const NotFound = (): React.JSX.Element => {
  useDocumentTitle('Page not found')

  return (
    <section>
      <h1>Page not found</h1>
      <p>There is nothing at this address. It may have been a share link that has since expired.</p>
      <p><Link to="/">Back to the start</Link></p>
    </section>
  )
}
