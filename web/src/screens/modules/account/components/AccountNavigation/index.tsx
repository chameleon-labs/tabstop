import {Button} from '@chameleon-labs/lattice-react';
import {Link} from 'react-router';
import {LogoutButton} from '../LogoutButton';
import type {LogoutMutation} from '../../mutations';
import {useSession} from '../../session';

export type AccountNavigationProps = {
  logout: LogoutMutation;
  sessionFree?: boolean;
};

export const AccountNavigation = ({logout, sessionFree = false}: AccountNavigationProps): React.JSX.Element => {
  const {data: account, error, isPending} = useSession({enabled: !sessionFree && !logout.isRevoked});

  if (logout.isRevoked) {
    return (
      <nav aria-label="Main">
        <LogoutButton logout={logout} />
      </nav>
    );
  }

  if (error !== null || (isPending && !sessionFree)) {
    return <nav aria-label="Main" />;
  }

  if (account === null || account === undefined) {
    return (
      <nav aria-label="Main">
        <Button variant="link" size="sm" render={<Link to="/login" />}>
          Log in
        </Button>
        <Button variant="primary" size="sm" render={<Link to="/signup" />}>
          Sign up
        </Button>
      </nav>
    );
  }

  return (
    <nav aria-label="Main">
      <Button variant="link" size="sm" render={<Link to="/dashboard" />}>
        Dashboard
      </Button>
      <LogoutButton logout={logout} />
    </nav>
  );
};
