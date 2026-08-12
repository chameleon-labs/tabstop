import {Button} from '@chameleon-labs/lattice-react';
import {Link} from 'react-router';
import {AccountMenu} from '../AccountMenu';
import {LogoutButton} from '../LogoutButton';
import type {LogoutMutation} from '../../mutations';
import {useSession} from '../../session';
import './styles.css';

export type AccountNavigationProps = {
  logout: LogoutMutation;
  /**
   * Read the session if it is already known, never ask for it.
   *
   * `useSession` turns this into `enabled: false`, which returns cached data
   * and issues no request - so the landing page still shows an account header
   * to a visitor who arrived from inside the app, and still costs a marketing
   * visitor nothing. A cold load of `/` shows the signed-out header even to
   * someone signed in, which is the accepted trade on #102.
   */
  sessionFree?: boolean;
};

export const AccountNavigation = ({logout, sessionFree = false}: AccountNavigationProps): React.JSX.Element => {
  const {data: account, error, isPending} = useSession({enabled: !sessionFree && !logout.isRevoked});

  if (logout.isRevoked) {
    return (
      <nav className="nav-main" aria-label="Main">
        <LogoutButton logout={logout} />
      </nav>
    );
  }

  if (error !== null || (isPending && !sessionFree)) {
    return <nav className="nav-main" aria-label="Main" />;
  }

  if (account === null || account === undefined) {
    return (
      <nav className="nav-main" aria-label="Main">
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
    <nav className="nav-main" aria-label="Main">
      <Button variant="link" size="sm" render={<Link to="/dashboard" />}>
        Dashboard
      </Button>
      <AccountMenu email={account.email} logout={logout} />
    </nav>
  );
};
