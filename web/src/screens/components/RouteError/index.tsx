import {Link, isRouteErrorResponse, useRouteError} from 'react-router';
import {ApiError} from '@/api/client';
import {useDocumentTitle} from '@/screens/hooks/use-document-title';
import {NotFound} from '../NotFound';
import {useOwnMain} from '../Layout';

export type ErrorPageProps = {
  error: unknown;
};

export const RouteError = (): React.JSX.Element => {
  const error = useRouteError();

  if (error instanceof ApiError && error.status === 404) {
    return <NotFound />;
  }
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFound />;
  }

  return <ErrorPage error={error} />;
};

const messageOf = (error: unknown): string | null => {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (isRouteErrorResponse(error)) {
    return error.statusText === '' ? null : error.statusText;
  }
  return null;
};

const ErrorPage = ({error}: ErrorPageProps): React.JSX.Element => {
  useDocumentTitle('Something went wrong');
  const detail = messageOf(error);
  const ownMain = useOwnMain();

  const body = (
    <section>
      <h1>Something went wrong</h1>
      {detail === null ? (
        <p>That did not work, and we do not have a useful explanation. Try again.</p>
      ) : (
        <p>{detail}</p>
      )}
      <p>
        <Link to="/">Back to the start</Link>
      </p>
    </section>
  );

  return ownMain ? (
    <main id="main" tabIndex={-1} className="app-shell__main">
      {body}
    </main>
  ) : (
    body
  );
};
