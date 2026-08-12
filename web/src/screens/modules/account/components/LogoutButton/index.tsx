import {Button, Callout} from '@chameleon-labs/lattice-react';
import {useEffect, useRef} from 'react';
import {AlertCircle} from '@/screens/components/Icons';
import {authFailureMessage} from '../../failure';
import {useSignOut} from '../../hooks/use-sign-out';
import type {LogoutMutation} from '../../mutations';

type LogoutButtonProps = {
  logout: LogoutMutation;
};

export const LogoutButton = ({logout}: LogoutButtonProps): React.JSX.Element => {
  const signOut = useSignOut(logout);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logout.error !== null) {
      alertRef.current?.focus();
    }
  }, [logout.error]);

  return (
    <>
      {logout.error === null ? null : (
        <Callout ref={alertRef} tabIndex={-1} variant="danger" icon={<AlertCircle size="sm" />} live="assertive">
          {authFailureMessage(logout.error)}
        </Callout>
      )}
      {!logout.isRevoked || logout.isPending ? (
        <Button type="button" variant="link" size="sm" disabled={logout.isPending} onClick={() => void signOut()}>
          {logout.isPending ? 'Signing out…' : 'Log out'}
        </Button>
      ) : null}
    </>
  );
};
