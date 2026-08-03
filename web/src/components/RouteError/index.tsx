import { Link, isRouteErrorResponse, useRouteError } from 'react-router'
import { ApiError } from '../../api/client'
import { useDocumentTitle } from '../../hooks/use-document-title'
import { NotFound } from '../NotFound'

export type ErrorPageProps = {
  error: unknown
}

/**
 * What a route renders when it throws.
 *
 * Wired as `errorElement` on a PATHLESS route below the layout, not on the
 * layout itself - an `errorElement` renders in place of the route that declares
 * it, so declaring it on the layout would take the header, the skip link and
 * every way out down with the screen. See `routes.tsx`.
 *
 * A 404 is not a crash and does not render as one: a share link that has
 * expired or been mistyped gets the same page as an unknown URL, because to the
 * person holding the link they are the same event.
 */
export const RouteError = (): React.JSX.Element => {
  const error = useRouteError()

  // Two shapes, because a 404 arrives by two routes: `ApiError` when a query
  // threw one, and a router `ErrorResponse` when a loader or the router itself
  // produced it. Checking only the first would render "something went wrong"
  // for half of the cases this exists to handle.
  if (error instanceof ApiError && error.status === 404) return <NotFound />
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />

  return <ErrorPage error={error} />
}

/**
 * Null when there is nothing worth showing a person.
 *
 * Deliberately narrow. A bare `Error` reaching here is a bug in our own code,
 * and its message is written for whoever is reading a stack trace - "Cannot
 * read properties of undefined" tells a visitor nothing and looks like a leak.
 * Only errors that carry a message meant for a person are shown.
 */
const messageOf = (error: unknown): string | null => {
  if (error instanceof ApiError) return error.message
  // Empty is not a message. `new Response(null, { status: 503 })` has no status
  // text at all, and HTTP/2 carries no reason phrase, so this is the common
  // case rather than a corner of it - returning `''` here passes the null check
  // below and renders an empty paragraph where the explanation should be.
  if (isRouteErrorResponse(error)) return error.statusText === '' ? null : error.statusText
  return null
}

const ErrorPage = ({ error }: ErrorPageProps): React.JSX.Element => {
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
