import {useCallback} from 'react';
import {useNavigate} from 'react-router';
import type {LogoutMutation} from '../mutations';

export const useSignOut = (logout: LogoutMutation): (() => Promise<void>) => {
  const navigate = useNavigate();

  return useCallback(async (): Promise<void> => {
    const succeeded = await logout.mutateAsync().then(
      () => true,
      () => false,
    );
    if (succeeded) {
      await navigate('/', {replace: true});
    }
  }, [logout, navigate]);
};
