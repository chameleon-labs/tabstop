import { Navigate, useLocation } from 'react-router'
import { useSession } from '../api/session'

/**
 * Gates a route on there being a session.
 *
 * There is no local check to make: the session is an httpOnly cookie, so this
 * always costs one `GET /api/me`. React Query caches it, so the cost is per
 * app load rather than per navigation.
 *
 * The pending state renders nothing rather than a spinner. This resolves in one
 * round trip on a request the browser has probably already started, and a
 * spinner that appears for 80ms and vanishes is worse than a beat of nothing -
 * for a screen reader it is an announcement about a state that no longer holds.
 *
 * A failed `/me` - not a 401, which `useSession` turns into `null`, but a real
 * failure - throws to the route error boundary rather than redirecting. A
 * broken backend must not look like being logged out; that would bounce every
 * signed-in user to a login page that cannot work either.
 */
export const RequireAuth = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const { data: account, isPending, error } = useSession()
  const location = useLocation()

  if (error !== null) throw error
  if (isPending) return <></>

  if (account === null) {
    // `replace`, so Back does not land on the gate again and bounce; `state`
    // so a login screen can return the user where they were going.
    return <Navigate to="/" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
