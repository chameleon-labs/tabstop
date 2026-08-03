import { useDocumentTitle } from '../../components/route-announcer'

/** Placeholder. The URL form and live audit progress are #19. */
export const Home = (): React.JSX.Element => {
  useDocumentTitle('')

  return (
    <section>
      <h1>Paste a URL, get an accessibility audit</h1>
      <p>The audit form lands in #19.</p>
    </section>
  )
}
