import {Button} from '@chameleon-labs/lattice-react';
import {Link} from 'react-router';
import {LogoutButton} from '../LogoutButton';
import {useSession} from '../../session';

export const AccountNavigation = (): React.JSX.Element => {
  const {data: account, error, isPending} = useSession();

  if (error !== null) {
    throw error;
  }

  if (isPending) {
    return <nav aria-label="Main" />;
  }

  if (account === null) {
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
      <LogoutButton />
    </nav>
  );
};
