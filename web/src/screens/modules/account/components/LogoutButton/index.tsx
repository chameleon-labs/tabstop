import {Button, Callout} from '@chameleon-labs/lattice-react';
import {useEffect, useRef} from 'react';
import {useNavigate} from 'react-router';
import {AlertCircle} from '@/screens/components/Icons';
import {authFailureMessage} from '../../failure';
import {useLogout} from '../../mutations';

export const LogoutButton = (): React.JSX.Element => {
  const logout = useLogout();
  const navigate = useNavigate();
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logout.error !== null) {
      alertRef.current?.focus();
    }
  }, [logout.error]);

  const signOut = async (): Promise<void> => {
    const succeeded = await logout.mutateAsync().then(
      () => true,
      () => false,
    );
    if (succeeded) {
      await navigate('/', {replace: true});
    }
  };

  return (
    <>
      {logout.error === null ? null : (
        <Callout ref={alertRef} tabIndex={-1} variant="danger" icon={<AlertCircle size="sm" />} live="assertive">
          {authFailureMessage(logout.error)}
        </Callout>
      )}
      <Button type="button" variant="link" size="sm" disabled={logout.isPending} onClick={() => void signOut()}>
        {logout.isPending ? 'Signing out…' : 'Log out'}
      </Button>
    </>
  );
};
