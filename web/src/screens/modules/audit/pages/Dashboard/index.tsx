import { useDocumentTitle } from '@/screens/hooks/use-document-title'

/** Placeholder. The monitored-pages list is #20. */
export const Dashboard = (): React.JSX.Element => {
  useDocumentTitle('Dashboard')

  return (
    <section>
      <h1>Dashboard</h1>
      <p>The monitored pages list lands in #20.</p>
    </section>
  )
}
