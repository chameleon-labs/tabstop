import {Navigate} from 'react-router';
import {useSession} from '../../session';

export type RequireAnonymousProps = {
  children: React.ReactNode;
};

export const RequireAnonymous = ({children}: RequireAnonymousProps): React.JSX.Element => {
  const {data: account, isPending, error} = useSession();

  if (error !== null) {
    throw error;
  }
  if (isPending) {
    return <></>;
  }

  return account === null ? <>{children}</> : <Navigate to="/dashboard" replace />;
};
