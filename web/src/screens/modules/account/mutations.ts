import type {AccountResponse} from '@tabstop/contract';
import {useMutation, useQueryClient, type UseMutationResult} from '@tanstack/react-query';
import {useState} from 'react';
import {post, request} from '@/api/client';
import {AuthConfirmationError} from './failure';
import {refreshSession} from './session';
import type {Credentials} from './validation';

export type LogoutMutation = UseMutationResult<void, Error, void> & {
  isRevoked: boolean;
};

const useCredentialMutation = (
  path: '/api/login' | '/api/signup',
): UseMutationResult<AccountResponse, Error, Credentials> => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (credentials: Credentials): Promise<AccountResponse> => {
      await post<AccountResponse>(path, credentials);
      const account = await refreshSession(queryClient);
      if (account === null) {
        throw new AuthConfirmationError('Could not confirm your session');
      }
      return account;
    },
  });
};

export const useLogin = (): UseMutationResult<AccountResponse, Error, Credentials> =>
  useCredentialMutation('/api/login');

export const useSignup = (): UseMutationResult<AccountResponse, Error, Credentials> =>
  useCredentialMutation('/api/signup');

export const useLogout = (): LogoutMutation => {
  const queryClient = useQueryClient();
  const [isRevoked, setIsRevoked] = useState(false);

  const mutation = useMutation({
    mutationFn: async (): Promise<void> => {
      await request<null>('/api/logout', {method: 'POST'});
      setIsRevoked(true);
      queryClient.removeQueries();
      const account = await refreshSession(queryClient);
      if (account !== null) {
        throw new AuthConfirmationError('Could not confirm that you signed out');
      }
    },
  });

  return {...mutation, isRevoked};
};
