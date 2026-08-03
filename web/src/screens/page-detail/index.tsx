import { useParams } from 'react-router'
import { useDocumentTitle } from '../../components/route-announcer'

/** Placeholder. The trend chart and violation detail are #21. */
export const PageDetail = (): React.JSX.Element => {
  const { id } = useParams<{ id: string }>()
  useDocumentTitle('Page')

  return (
    <section>
      <h1>Page {id}</h1>
      <p>The score trend and violation detail land in #21.</p>
    </section>
  )
}
