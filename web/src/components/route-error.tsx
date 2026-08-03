import { Link, isRouteErrorResponse, useRouteError } from 'react-router'
import { ApiError } from '../api/client'
import { NotFound } from './not-found'
import { useDocumentTitle } from './route-announcer'

/**
 * What a route renders when it throws.
 *
 * Wired as `errorElement` on the root route, so a crash in one screen replaces
 * that screen rather than blanking the app - the header and skip link survive,
 * and there is still a way out.
 *
 * A 404 is not a crash and does not render as one: a share link that has
 * expired or been mistyped gets the same page as an unknown URL, because to the
 * person holding the link they are the same event.
 */
export const RouteError = (): React.JSX.Element => {
  const error = useRouteError()

  if (error instanceof ApiError && error.status === 404) return <NotFound />
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />

  return <ErrorPage error={error} />
}

const messageOf = (error: unknown): string | null => {
  if (error instanceof ApiError) return error.message
  if (isRouteErrorResponse(error)) return error.statusText
  return null
}

const ErrorPage = ({ error }: { error: unknown }): React.JSX.Element => {
  useDocumentTitle('Something went wrong')
  const detail = messageOf(error)

  return (
    <section>
      {/* The only h1 on the page: the error IS the page now, so the heading
          outline has to say so rather than leaving the previous screen's. */}
      <h1>Something went wrong</h1>
      {detail === null
        ? <p>That did not work, and we do not have a useful explanation. Try again.</p>
        : <p>{detail}</p>}
      <p><Link to="/">Back to the start</Link></p>
    </section>
  )
}
