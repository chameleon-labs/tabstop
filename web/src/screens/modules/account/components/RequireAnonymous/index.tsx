import {Navigate, useLocation} from 'react-router';
import {useSession} from '../../session';
import {destinationFrom} from '../../return-to';

export type RequireAnonymousProps = {
  children: React.ReactNode;
};

export const RequireAnonymous = ({children}: RequireAnonymousProps): React.JSX.Element => {
  const {data: account, isPending, error} = useSession();
  const location = useLocation();

  if (error !== null && account === undefined) {
    throw error;
  }
  if (isPending) {
    return <></>;
  }

  return account === null ? <>{children}</> : <Navigate to={destinationFrom(location.state)} replace />;
};
