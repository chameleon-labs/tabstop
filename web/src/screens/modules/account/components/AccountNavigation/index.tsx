import {Button} from '@chameleon-labs/lattice-react';
import {Link} from 'react-router';
import {LogoutButton} from '../LogoutButton';
import {useLogout} from '../../mutations';
import {useSession} from '../../session';

export const AccountNavigation = ({sessionFree = false}: {sessionFree?: boolean}): React.JSX.Element => {
  const logout = useLogout();
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
